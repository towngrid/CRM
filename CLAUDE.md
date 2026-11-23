# TownGrid CRM: project notes for Claude Code

Read this first. The full build spec is `docs/LEAD-FINDER-SPEC.md`; follow it exactly.
Seann (owner) is non-technical: explain each step in plain words, give exact clicks, and stop after each step so he can check it.

## What this is
A private sales tool for TownGrid, built from a copy of ESyCRM. It finds local businesses, checks their website, social and ordering, tags each with a lead type, and moves the ones Seann approves into contacts, pipeline and (later) outreach.

## Hard rules
- **All work happens on the `towngrid` branch.** Never change `main`: it is the untouched ESyPet snapshot.
- **Never touch the ESyPet Replit app (esypet-crm.replit.app), its Neon database or its keys.**
- **TownGrid and ESyPet never share accounts or keys.** New database, new login, TownGrid's own SerpAPI key, TownGrid's own Brevo. Never reuse a value from the old ESyPet `.env` or Replit Secrets.
- **Never put keys in code or in chat, and never ask Seann to paste one.** Tell him the Railway variable name; he sets it himself. No `.env` files in the repo.
- **Email sending stays off** (`ENABLE_OUTREACH_SENDING=off`) until Seann says his written SEAP approval has arrived. Building and testing privately is OK. No new paid accounts without his OK (TownGrid's own SerpAPI account is approved).
- **Cold email never goes through Brevo and never comes from towngrid.net.** It will come from seann@towngrid.contact through the Gmail API (on hold). Brevo is only for sign-in codes.
- **No scraping of sites that forbid it.** Never open Facebook, Instagram, Yelp, BBB, DoorDash, Grubhub, Uber Eats or Slice pages from code; use only search results (link, title, snippet). No `facebookexternalhit` tricks. Opening the business's own website is fine.
- No ESyPet names, addresses, plans or email text anywhere a user sees. Admin alert and report recipients come from `ADMIN_ALERT_EMAILS` (default seann@towngrid.net).

## Working with this copy
- `attached_assets/` is not checked out (Windows can't hold its filenames) and is deleted on this branch. Don't run git commands that need the whole file list (`git ls-files` crashes here).
- Railway variables (names only): `DATABASE_URL`, `SESSION_SECRET`, `SERPAPI_KEY`, `BREVO_API_KEY`, `ADMIN_ALERT_EMAILS`, `ENABLE_OUTREACH_SENDING`.

## Status
- Step 0 (clean-up): done Nov 22, 2026, waiting for Seann's check. Step 0.1 (Neon password, Replit secrets) done by Seann.
  Left for later steps: the salon research code still uses the internal tag `directory_general` and the salon/mobile "software" tracks (replaced in Steps 2, 3 and 6); `docs/new-salesperson-setup.md`, `replit.md` and `design_guidelines.md` still describe ESyCRM.
- Step 1 (Nov 22, 2026): code done and pushed (emailed-code sign-in in `server/auth.ts`, node-postgres driver, `ENABLE_OUTREACH_SENDING` switch: only exactly "on" sends). Railway: Postgres service "Postgres" (CRM only) and empty service "crm" created in project TownGrid, domain crm-production-59a974cd.up.railway.app (port 8080), build `npm run build`, pre-deploy `npm run db:push`, start `npm start`. Source: `towngrid/CRM`, branch `towngrid` (pushes to it redeploy the CRM). Variables set by Seann. First deploy Nov 23, 2026 04:27 UTC: tables created, admin account created, scheduler off, Brevo account is TownGrid's. **Step 1 done and checked: Seann signed in with an emailed code.** Step 2 waits for his OK. Never touch "marketing-engine".
- The admin account seann@towngrid.net is created automatically when the users table is empty.
- `db:push` runs on every deploy; later schema changes that drizzle-kit would ask about (renames, drops) may stall it. Check the pre-deploy log when changing `shared/schema.ts`.
- Known: 20 of 41 test files fail (same 20 as on `main`; Step 1 added `server/outreachSwitch.test.ts`, which passes). `npx tsc` and `npm run build` pass.

## To-do (agreed with Seann)
- Before Step 3: fix or remove the 20 test files that already fail on `main`.
- In Step 2: update or delete the three old ESyCRM guides (`docs/new-salesperson-setup.md`, `replit.md`, `design_guidelines.md`).
