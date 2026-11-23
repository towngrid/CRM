import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startEmailSequenceScheduler } from "./emailScheduler";
import { startTaskReminderScheduler } from "./taskReminderScheduler";
import { startCommissionScheduler } from "./commissionScheduler";
import { startDailyReportScheduler } from "./dailyReportScheduler";
import { startSalonResearchSynchronization } from "./salonResearch";
import { startFullResearchScheduler } from "./fullResearchQueue";
import { isOutreachSendingEnabled } from "./appConfig";

const app = express();
// Uploaded enrichment batches can contain the full source row for thousands of
// businesses. Keep the limit bounded, but large enough for the supported list.
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: false }));

// Private tool: keep every page out of search engines.
app.use((_req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});
app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send(["User-agent: *", "Disallow: /", ""].join("\n"));
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);
  startSalonResearchSynchronization();
  startFullResearchScheduler();

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    
    // Email sequence scheduler: only when ENABLE_OUTREACH_SENDING is "on".
    if (app.get("env") === "production" && isOutreachSendingEnabled()) {
      log("Starting email sequence scheduler...");
      startEmailSequenceScheduler();
    } else {
      log('Email sequence scheduler off (ENABLE_OUTREACH_SENDING is not "on")');
    }

    // Start task reminder scheduler (always runs, checks every 15 min)
    if (app.get("env") === "production") startTaskReminderScheduler();

    // Start commission monthly payment scheduler (always runs, checks every 24 hours)
    if (app.get("env") === "production") startCommissionScheduler();

    // Start daily activity report scheduler (sends at 6:00 PM ET every day)
    if (app.get("env") === "production" && process.env.BREVO_API_KEY) {
      startDailyReportScheduler();
    }
  });
})();
