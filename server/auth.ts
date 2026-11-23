// Emailed-code sign-in. No passwords and no self sign-up: only email addresses
// already in the users table can sign in. Codes are 6 digits, expire after
// 10 minutes and work once. Sessions are stored in Postgres (connect-pg-simple).
import crypto from "crypto";
import passport from "passport";
import session from "express-session";
import connectPg from "connect-pg-simple";
import type { Express, RequestHandler } from "express";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { storage } from "./storage";
import { loginCodes, users } from "@shared/schema";
import { sendEmail } from "./sendgrid";
import { APP_NAME, OWNER_EMAIL } from "./appConfig";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS_PER_CODE = 5;
const MAX_CODES_PER_HOUR = 5;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  claims: { sub: string; email: string };
  userId: string;
  role: string;
}

function requireSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set (at least 32 characters).");
  }
  return secret;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashCode(email: string, code: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${normalizeEmail(email)}:${code}`).digest("hex");
}

export function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function getSession() {
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: SESSION_TTL_MS / 1000,
    tableName: "sessions",
  });
  return session({
    secret: requireSessionSecret(),
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_TTL_MS,
    },
  });
}

async function findUserByEmail(email: string) {
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${normalizeEmail(email)}`);
  return user;
}

/** Creates the owner as admin when the users table is empty (first start on a new database). */
async function ensureOwnerAccount() {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  if (count === 0) {
    await storage.createUser({ email: OWNER_EMAIL, role: "admin" });
    console.log(`[Auth] Created the admin account for ${OWNER_EMAIL}.`);
  }
}

function signInEmailHtml(code: string): string {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1f2937">
<p>Your ${APP_NAME} sign-in code is:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>
<p>It works once and expires in 10 minutes.</p>
<p style="color:#6b7280;font-size:13px">If you didn't ask for this, you can ignore this email.</p>
</body></html>`;
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  await ensureOwnerAccount();

  const genericReply = { message: "If that address has an account, a sign-in code is on its way." };

  app.post("/api/auth/request-code", async (req, res) => {
    const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Please enter a valid email address." });
    const email = normalizeEmail(parsed.data.email);

    try {
      const user = await findUserByEmail(email);
      // Same reply either way, so the form doesn't reveal who has an account.
      if (!user) return res.json(genericReply);

      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const [{ recent }] = await db
        .select({ recent: sql<number>`count(*)::int` })
        .from(loginCodes)
        .where(and(eq(loginCodes.email, email), gt(loginCodes.createdAt, hourAgo)));
      if (recent >= MAX_CODES_PER_HOUR) {
        return res.status(429).json({ message: "Too many codes requested. Please wait an hour and try again." });
      }

      const code = generateCode();
      const secret = requireSessionSecret();
      // A new code replaces any earlier unused one.
      await db.update(loginCodes).set({ usedAt: new Date() })
        .where(and(eq(loginCodes.email, email), isNull(loginCodes.usedAt)));
      await db.insert(loginCodes).values({
        email,
        codeHash: hashCode(email, code, secret),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      });

      const result = await sendEmail({
        to: user.email!,
        subject: `${APP_NAME} sign-in code: ${code}`,
        body: signInEmailHtml(code),
      });
      if (!result.success) {
        console.error(`[Auth] Could not send sign-in code: ${result.error}`);
        return res.status(502).json({ message: "The sign-in email could not be sent. Please try again in a minute." });
      }
      res.json(genericReply);
    } catch (error) {
      console.error("[Auth] request-code error:", error);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  app.post("/api/auth/verify-code", async (req, res, next) => {
    const parsed = z.object({ email: z.string().email(), code: z.string().trim().regex(/^\d{6}$/) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Enter the 6-digit code from the email." });
    const email = normalizeEmail(parsed.data.email);
    const wrong = { message: "That code is wrong or has expired. Ask for a new one." };

    try {
      const [pending] = await db.select().from(loginCodes)
        .where(and(eq(loginCodes.email, email), isNull(loginCodes.usedAt), gt(loginCodes.expiresAt, new Date())))
        .orderBy(sql`${loginCodes.createdAt} desc`)
        .limit(1);
      if (!pending || pending.attempts >= MAX_ATTEMPTS_PER_CODE) return res.status(401).json(wrong);

      const expected = Buffer.from(pending.codeHash, "hex");
      const given = Buffer.from(hashCode(email, parsed.data.code, requireSessionSecret()), "hex");
      if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
        await db.update(loginCodes).set({ attempts: sql`${loginCodes.attempts} + 1` }).where(eq(loginCodes.id, pending.id));
        return res.status(401).json(wrong);
      }

      // Mark used in one step so the same code can't be used twice at the same moment.
      const claimed = await db.update(loginCodes).set({ usedAt: new Date() })
        .where(and(eq(loginCodes.id, pending.id), isNull(loginCodes.usedAt)))
        .returning({ id: loginCodes.id });
      if (claimed.length === 0) return res.status(401).json(wrong);

      const user = await findUserByEmail(email);
      if (!user) return res.status(401).json(wrong);

      const sessionUser: SessionUser = {
        claims: { sub: user.id, email: user.email! },
        userId: user.id,
        role: user.role || "salesperson",
      };
      req.login(sessionUser, (err) => {
        if (err) return next(err);
        res.json({ ok: true });
      });
    } catch (error) {
      console.error("[Auth] verify-code error:", error);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  const logout: RequestHandler = (req, res) => {
    req.logout(() => {
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        if (req.method === "GET") res.redirect("/");
        else res.json({ ok: true });
      });
    });
  };
  app.get("/api/logout", logout);
  app.post("/api/logout", logout);
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as SessionUser | undefined;
  if (!req.isAuthenticated() || !user?.claims?.sub) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    // Re-check the account on every request: removed users lose access at once.
    const dbUser = await storage.getUser(user.claims.sub);
    if (!dbUser) return res.status(401).json({ message: "Unauthorized" });
    user.role = dbUser.role || "salesperson";
  } catch (error) {
    console.error("[Auth] Error refreshing user role:", error);
    return res.status(500).json({ message: "Could not check your account" });
  }
  return next();
};

export const isAdmin: RequestHandler = (req, res, next) => {
  isAuthenticated(req, res, () => {
    const user = req.user as SessionUser;
    if (user.role !== "admin") {
      return res.status(403).json({ message: "Forbidden: Admin access required" });
    }
    next();
  });
};
