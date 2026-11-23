# TownGrid Lead Finder and CRM: build spec

Written Nov 22, 2026; updated the same day (lead types instead of scores, SerpAPI OK, cold email from a look-alike domain via Gmail, never Brevo). For Claude Code (or Sri). Seann is non-technical: give him plain steps and expect him to check the work.

## What this is
A private sales tool for TownGrid, built from a copy of ESyCRM (Seann's CRM, originally built for ESyPet). It finds local businesses by type and town or zip code, checks whether each one has a website, a Facebook page and an Instagram account, checks restaurants for delivery apps and their own online ordering, tags each business with a lead type, and moves the ones Seann approves into contacts, pipeline and (later) email outreach.

**Permission:** Seann built ESyCRM himself on his own Replit account and at his own expense. Ravin (ESyPet co-founder) agreed on Nov 22, 2026 that TownGrid can reuse the code. ESyPet does not use the CRM.

**Repo:** `towngrid/CRM` on GitHub (private). The live ESyPet app still runs on Replit at esypet-crm.replit.app with its own Neon database. **Never touch the Replit app, its database or its keys.**

## Hard rules
- **Do all work on a new branch named `towngrid`.** Leave `main` as the untouched ESyPet snapshot, so nothing changes for the Replit app if it ever pulls from this repo.
- **TownGrid and ESyPet never share accounts or keys.** New database, new login, TownGrid's own search key, TownGrid's own Brevo. Never reuse a value from the ESyPet `.env` or Replit Secrets.
- **Never put keys in code or in chat.** Keys go in Railway variables and Seann's password manager only. No `.env` files in the repo.
- **SEAP pause:** TownGrid is paused until Seann's written SEAP approval (see `claude/START-HERE.md`). Building and testing privately is OK. **Email sending stays off** (`ENABLE_OUTREACH_SENDING=off`) until Seann says the approval has arrived. Seann confirmed on Nov 22 that creating TownGrid's own SerpAPI account and key is OK now. Other new paid accounts still wait for his OK.
- **No scraping of sites that forbid it.** Remove the code that opens Facebook pages while pretending to be Facebook's crawler (`facebookexternalhit`), and the code that opens Yelp and BBB pages directly. Use only search results (link, title, snippet) for Facebook, Instagram, Yelp, BBB, DoorDash, Grubhub, Uber Eats and Slice. Opening the business's **own** website is fine.

## Step 0: clean-up (do first, in this order)
1. **Seann, by hand (not Claude Code):** reset the Neon database password and update `DATABASE_URL` / `PGPASSWORD` in Replit Secrets; change `SESSION_SECRET` in Replit Secrets. The repo was briefly public on Nov 22 with these in `.env (copy)`.
2. Create the `towngrid` branch.
3. Delete from the branch: `.env (copy)`, the whole `reports/` folder (salon lead lists), the whole `attached_assets/` folder (screenshots, ESyPet email documents, spreadsheets), `beta-deal-error.png`, `no-login-button.png`, `Sri_SendGrid_Setup.md`. Add `.env*`, `reports/` and `attached_assets/` to `.gitignore`.
4. Remove all hardcoded ESyPet addresses: `seann@esypet.com`, `ravin@esypet.com`, `srinath@esyntaxis.com`, `esypet.app`, `esypet.com` (in `server/routes.ts` lines ~1567 and ~1966, `server/dailyReportScheduler.ts`, `server/sendgrid.ts`, `server/directoryEmailSequences.ts`, `server/lead-discovery.ts`, `shared/schema.ts`, settings, admin-users and the sequence screens). Admin alert and report recipients come from one setting (Railway variable `ADMIN_ALERT_EMAILS`), default `seann@towngrid.net`.
5. Rename the app from ESyCRM to **TownGrid CRM** everywhere a user sees it.
6. Delete the "Directory-First", groomer and ESyPet email sequences and their templates (EsyPet links, "fellow groomer" text, MoeGo and Groomer.io tracks). TownGrid sequences get written later (see Step 6).

## Step 1: hosting, database and login
- **Hosting:** a new service named `crm` in the existing Railway project "TownGrid". Use the Railway-generated web address for now; not linked from towngrid.net and not indexed by search engines (`noindex`).
- **Database:** a new PostgreSQL database in the same Railway project, used only by the CRM. Create the tables from `shared/schema.ts` with `drizzle-kit push`. It starts empty: no ESyPet users, contacts, deals or emails.
- **Login (replaces Replit login):** remove Replit Auth (`server/replitAuth.ts`, `REPLIT_DOMAINS`, `ISSUER_URL`). Replace with **email sign-in by link or 6-digit code**, no passwords, the same pattern planned for the owner dashboard in `claude/OWNER-EDITING-SPEC.md`. Codes expire after 10 minutes and work once. Sent through TownGrid's Brevo. Only email addresses already in the users table can sign in (no self sign-up). Sessions stay in Postgres (`connect-pg-simple`) with a new `SESSION_SECRET` set in Railway.
- **Users:** create one admin user, `seann@towngrid.net`. Keep the salesperson role and data isolation for later hires. Create no test users.

## Step 2: TownGrid plans, pipeline and wording
- **Plans** (replace Solo / Salon / Signature in `shared/dealPlans.ts`):
  - Get Seen $129/mo
  - Get Seen Plus $179/mo (price to confirm)
  - Delivery Listing $39/mo
  - Restaurant ordering $79/mo and $129/mo
  - Founding partner $49/mo
  - Add-ons: logo $49 one-time, customer emails $29/mo
  - Keep plans in one editable list so prices can change without code changes if possible.
- **Commissions and payroll:** keep the code but hide those pages from the menu for now (no salespeople yet). Remove the hardcoded ESyPet commission splits.
- **Pipeline stages:** keep the current 11 stages, and add **Site visit booked** after "Contacted - Phone - Left Message".
- **"Uses Software" fields and filters** (grooming booking software): replace with the TownGrid fields below.

## Step 3: the business search (the main new work)
### Search screen
- Pick a **business type** from a list: pet groomers, dog walkers, pet sitters, pizzerias, restaurants, food trucks, landscapers, cleaners, handymen, mobile detailers, plus "Other (type it)". Remove "pet grooming" wherever it is written into searches and queries.
- Pick **where**: one or more towns or zip codes. Add a saved list of Long Island zip codes so Seann can pick a town or "all of Nassau" / "all of Suffolk". Remove the 3-zip limit; keep a clear cost estimate and a confirm step before a search runs.
- Pick the **list**: Get Seen or Ordering (restaurants, pizzerias and food trucks default to Ordering).

### Finding businesses
- Keep SerpAPI's Google Maps search (already built, with caching, a monthly budget and a hard stop). TownGrid needs **its own SerpAPI key** in Railway (`SERPAPI_KEY`); Seann is creating the TownGrid SerpAPI account (Nov 22). Set the budget in the existing budget settings. Later option: switch this step to Google's official Places API.
- Save for each business: name, address, town, zip, phone, Google rating, review count, Google listing link, Google category, website (if listed), and for food businesses any delivery, takeout or "order online" details the result includes.
- Remove duplicates by phone number, normalized website and name-plus-address.

### Checks for every business
1. **Website:** if Google lists one, open it (this is allowed) and record: it loads or not, the copyright year if shown, whether it works on a phone (has a viewport tag), and whether it has a contact or request form. If Google lists none, run one web search for "business name + town" and accept a result only if its name and town or phone match. Nothing found → **"No Website found"**.
2. **Facebook:** one search limited to facebook.com for "business name + town". Accept a page only if the title or snippet matches the name and the town or phone. Save the link. None → **"No Facebook found"**.
3. **Instagram:** the same, limited to instagram.com. Save the link. None → **"No Instagram found"**.
4. If both 2 and 3 find nothing → **"No social found"**.
5. Mark each social link **"Likely match: check by hand"**. Follower counts and how recently they post are a hand check by Seann (a "Checked" box plus fields for followers and last post date on the business record). Never open Facebook or Instagram pages from code.

### Extra checks for the Ordering list
6. **Delivery apps:** search results for "business name + town" with doordash.com, grubhub.com, ubereats.com and slicelife.com. Record which apps it's on, with links.
7. **Own online ordering:** on the business's own website, look for ordering links or widgets (Toast, ChowNow, Slice, Square Online, Clover, Menufy, BeyondMenu, Grubhub or DoorDash storefront links). Record "Takes orders on own site: Yes / No / No website".
8. **Delivery or takeout:** from the Google Maps result if present.

### Lead types instead of scores (decided Nov 22)
Seann's call: **don't grade leads yet.** A business with no website or social may simply not have gone online because of the cost, and could sign once it hears TownGrid's price. So nothing is hidden or marked "weak"; every business gets a **lead type** (a tag), and the CRM tracks which types turn into customers. After the first 50–100 businesses contacted, Seann decides which types to call first.

**Get Seen list, lead types**
- **Social, no website:** has Facebook or Instagram, no website.
- **Starting from scratch:** no website and no social. Pitch: the price and "we do it all for you."
- **Old or broken website:** copyright 3+ years old, doesn't load, or not phone-friendly.
- **Website, no social:** has a working site, no Facebook or Instagram.
- **Already online:** working modern site and social. Lowest priority, still listed.

**Ordering list, lead types**
- **On delivery apps, no own ordering:** on DoorDash, Grubhub, Uber Eats or Slice; no ordering on its own site.
- **No online ordering anywhere.**
- **Own ordering already:** takes orders on its own site (Get Seen prospect instead; note the platform, e.g. GloriaFood, which is shutting down).

**"Still open?" check (every business):** flag businesses Google shows as permanently or temporarily closed, and show the newest Google review date when the search result includes it, so Seann can spot businesses that are gone. Don't remove them automatically.

**Also flag "Serves customers in person: check"** (storefront or visits customers), because Google profiles need it (see START-HERE).

**Tracking:** reports show, per lead type, how many were contacted, replied, had a visit, and signed. Scoring rules get written later from those numbers. Keep the lead types in one editable list.

### Results screen
- One table per search: name, town, phone, lead type, website (link or "No Website found"), Facebook, Instagram (link or "No social found"), delivery apps, own ordering, rating, reviews.
- Filters by list, lead type and town. Sort by lead type, then review count.
- Export to CSV and Excel.
- Keep the existing review step: Seann approves a business before it goes into Contacts and Pipeline. Nothing is emailed automatically.

## Step 4: business record and pre-visit page
- On each contact and deal, fill the existing "Social & Web" and "Digital Presence" sections with the findings above, with the date each was checked.
- Add a **Pre-visit brief** button on the deal page that shows one printable page: what they have now (website, Google rating and reviews, social links, delivery apps), the lead type and why, which TownGrid plan fits, room for Seann's notes, and the Site Visit and Log Call buttons that already exist. Talking points come from `claude/SALES-PITCHES.md` later; for now leave a notes box.

## Step 5: fixes carried over from ESyCRM
- Dashboard percentages ("+12% from last month" etc.) are typed into `client/src/components/dashboard/metrics-grid.tsx`. Calculate them from real data or remove them.
- Recent Activity shows raw code text (JSON). Show a readable line instead ("Email 2 sent to Dog Tales Pet Spa").
- **Test that replies reach the Inbox** before any real sending: send a test sequence to Seann, reply to it, and confirm it appears. In ESyCRM about 20 businesses got 4 emails each and the Inbox shows nothing, so check whether reply routing ever worked.

## Step 6: email outreach (build now, keep switched off)
- Keep the sequence engine, queue, auto-chaining, stop-on-reply and the Seq Test lab.
- Sending switch: `ENABLE_OUTREACH_SENDING` in Railway, **off** until Seann's SEAP approval.
- **Decided Nov 22: cold emails never come from towngrid.net.** They come from **towngrid.contact** (bought by Seann Nov 22; cheap and disposable: if it gets marked as spam, drop it and buy another), so spam complaints can't hurt towngrid.net's email reputation. Some spam filters are stricter with newer endings like .contact than with .com, so the slow ramp-up matters even more. Set up SPF, DKIM and DMARC on that domain, and make every link and the signature point to towngrid.net.
- **Never send cold email through Brevo** (TownGrid's or any client's). Brevo's anti-spam policy forbids emailing contacts who haven't opted in, including lists found on the internet, and it suspends accounts that break it; TownGrid's Brevo is needed for logins, client emails and the website. The old ESyCRM sent its sequences through Brevo; replace that path for cold email.
- **How cold email is sent instead (mailbox on hold, Nov 22):** Seann is holding off on a Google Workspace account for towngrid.contact for now. When he sets it up, it must be a **separate** Workspace, not a second domain added to TownGrid's existing Workspace: if Google suspends the cold-email account, seann@towngrid.net must not go down with it. Plan: one Google Workspace mailbox on towngrid.contact, **seann@towngrid.contact** (decided Nov 22; the address all cold emails come from and replies go to), sent from the CRM through the Gmail API, one message at a time like a normal person, never as a bulk blast. Warm the mailbox up for 2–3 weeks before real sending, then ramp slowly: week 1 about 5 cold emails a day, week 2 about 10, week 3 about 20, then a hard cap of 30 a day per mailbox, pausing the ramp if bounces pass 3% or any spam complaint comes in; stop the sequence on any reply, bounce or unsubscribe. Replies land in that mailbox and the CRM reads them into the Inbox through the Gmail API (this also replaces the Mailgun reply routing that may never have worked).
- **Cloudflare Email Routing (Nov 22):** OK to set up a forwarding address on towngrid.contact (seann@towngrid.contact forwarding to seann@towngrid.net until the mailbox exists) so replies and DMARC reports have somewhere to land. It only receives; it cannot send. Do **not** send as towngrid.contact from the towngrid.net Gmail ("Send mail as"): that puts cold email back on TownGrid's main Google account.
- Every cold email must have TownGrid's physical mailing address, a working unsubscribe link or "reply STOP" that is honored, an honest subject line and a real reply-to. Unsubscribed and bounced addresses are never emailed again, from any domain.
- Sequence wording is written later with Seann (two tracks: Get Seen and Ordering; "Starting from scratch" leads lead with the price).
- Brevo stays in use only for transactional email to people who expect it (CRM sign-in codes).

## Railway variables (names only, values set by Seann)
`DATABASE_URL`, `SESSION_SECRET`, `SERPAPI_KEY`, `BREVO_API_KEY` (sign-in codes only), `ADMIN_ALERT_EMAILS`, `ENABLE_OUTREACH_SENDING=off`, and the Gmail API credentials for the towngrid.contact mailbox (later).

## Done means
- Seann signs in with an emailed code at the Railway address. The app says TownGrid CRM, with no ESyPet names, addresses, plans or emails anywhere.
- A test search for "pizzerias in Massapequa" and "pet groomers in 11758" returns lists with lead types, website, Facebook and Instagram links or the "not found" wording, and delivery app results for the pizzerias.
- Approving a business moves it to Contacts and Pipeline with its findings, and the Pre-visit brief prints on one page.
- Sending is off, and a test reply shows up in the Inbox.
