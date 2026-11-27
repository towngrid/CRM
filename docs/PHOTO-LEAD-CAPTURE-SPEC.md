# TownGrid CRM: Snap a Lead (photo lead capture) and Industry column: build spec

Written Nov 26, 2026. For Claude Code, working in the TownGrid CRM (`C:\dev\towngrid-crm`, repo `towngrid/CRM`, branch `towngrid`). Read the repo's `CLAUDE.md` and `docs/LEAD-FINDER-SPEC.md` first: every hard rule there applies here too. Seann is non-technical: give plain steps, ask before anything that costs money or creates an account, and expect him to check the work.

## What this is
Seann sees a business storefront or a work van while he's out. He takes a photo of it with his phone from an icon on his Home Screen. The CRM saves the photo right away, then works in the background:
1. it reads the business name, phone, website and anything else visible on the sign or van;
2. it finds the business online and runs the same checks as Business Search;
3. it picks an industry;
4. it puts the result in a review list.

Seann approves each one into Contacts and Pipeline, the same as search results. Nothing is emailed or contacted automatically.

Also add an **Industry** field with a column and a filter everywhere Seann looks at businesses (see Part 2).

## Hard rules for this feature
- **Never encourage use while driving.** The capture page is one tap, for when Seann is parked or a passenger is holding the phone. No voice prompts, no pop-ups that need reading, no "you passed a business" alerts. Put a one-line reminder under the camera button: "Parked or passenger only."
- **Only what the photo shows, and only public facts.** Never guess an email, phone number or owner name. Every finding records its source (the photo, Google, the business's own website, a directory search result). Email rules come from `docs/PRE-VISIT-RESEARCH.md` (copy it into the repo if it isn't there): an email painted on the van counts as found, with source "photo".
- **Photos stay private.** They go in a private bucket and are shown only through short-lived signed links inside the CRM. They're never used in marketing. If a photo shows people or license plates, that's fine for the lead, but it is never shown outside the CRM.
- **Keys:** use the existing Railway variables `ANTHROPIC_API_KEY` (the CRM's own key, TownGrid Console organization) and `SERPAPI_KEY`. No new keys in code or chat. Tell Seann the names of any new variables; he sets them.
- **Credit caps:** SerpAPI calls from this feature count toward the existing CRM cap (900 a month, 100 an hour). Show this feature's share on the usage screen.
- Behind a switch: `ENABLE_PHOTO_LEADS`, off by default.

## Part 1: Snap a Lead

### The phone page (`/snap`)
- **Installable web app:** add a web app manifest and icons (TownGrid logo, from the brand colors: blue-gray #4A5568, red #D04B26, orange #F1833A, gold #F5A932). The app name is "TownGrid Snap". Opening it from the Home Screen goes straight to `/snap`, full screen, with no browser bars. No app store.
- **Screen:** one big **Take photo** button. It opens the rear camera through `<input type="file" accept="image/*" capture="environment">`. There is a smaller **Choose from Photos** button below it that allows several photos at once, for pictures taken earlier with the normal camera. There is an optional one-line note field, which can be skipped. There is a list of the last 10 snaps with their status.
- **Each snap saves:** the photo, the time, and the phone's location if Seann allows it (ask once; it still works if he says no). Use the location from the photo's own data when choosing from Photos.
- **Phone-side compression:** shrink to about 1600 px on the long side, JPEG, before uploading. Keep the photo's location data in the database, not in the shared file.
- **Works with bad signal:** if the upload fails, keep the photo on the phone (IndexedDB) and retry automatically when the signal returns. Show "Saved on phone, 2 waiting to upload". Never lose a photo.
- **Sign-in:** the same emailed-code login. On the phone, keep Seann signed in for 90 days so he isn't asked for a code on the street. Add **Sign out all devices** in Settings in case the phone is lost.

### Storage
- A **private Railway bucket** in the TownGrid project, named `crm-photos`. This is in the existing Railway account, so it's not a new account. Ask Seann before creating it and tell him the monthly cost estimate.
- Keep photos of approved leads with the lead. Delete photos of rejected leads after 30 days.

### Background processing (runs after upload; Seann never waits)
1. **Read the photo** with a current Claude model that reads images. Put the model name in the variable `PHOTO_MODEL`, check Anthropic's docs for the current name, and tell Seann what you picked. Claude returns structured JSON with:
   - business name;
   - every phone number, website, email and social handle visible;
   - services listed;
   - towns or service area listed;
   - what it is (`storefront`, `vehicle`, `sign`, `other`);
   - an industry from the list in Part 2;
   - how sure it is (high, medium, low);
   - all the raw text it read.

   Instruction to Claude: report only what is visible, never fill gaps.
2. **Nothing readable:** if there's no business name and no phone number, mark the snap **Needs a look** and stop. Seann can type the name in by hand, and that restarts processing.
3. **Duplicate check:** match against existing search results, contacts and deals by phone number (+1 format), website domain, and name plus town. On a match, mark it **Already in CRM** and link to the record. Don't create a second one.
4. **Find it online (Pass 1 for one business):**
   - **Storefront or sign:** a Google Maps search for the name near the photo's location (about 1 SerpAPI credit). The location is the business's address.
   - **Vehicle:** the photo's location is NOT the business's location, because vans travel. Search by the phone number and the name, plus the town painted on the van if any. Never record where the van was parked as the business's address.
   - Then run the same Pass 1 checks Business Search already runs: website, Facebook and Instagram, delivery apps and own ordering for restaurants (including check 6b), and lead type. Reuse that code; don't write a second copy.
   - **Email:** first one painted on the photo, then the business's own website, then directory search results, following the existing rules. Never guessed.
5. **Status** for each snap:
   - **Uploading**
   - **Reading**
   - **Found**: matched to a Google profile
   - **Found, not on Google**: no profile found. That's a strong lead in its own right, because it means "Starting from scratch".
   - **Needs a look**
   - **Already in CRM**
   - **Error**: with the reason in plain words

### Where the results go
- A new list in Business Search called **Photo leads**, newest first. It shows the photo thumbnail, what was read, what was found online, the industry, the lead type and the status.
- **Edit before approving:** Seann can fix the name, phone or industry, then press **Re-check**.
- **Approve** moves it into Contacts and Pipeline exactly like a search result, with the photo attached to the record and the source set to "Photo lead (date, town)". **Reject** hides it.
- The Pre-visit brief shows the photo, for "I saw your van in Massapequa".

### Costs (estimates; show the real counts on the usage screen)
- About 1–3 cents of Claude per photo, plus 1–3 SerpAPI credits per photo. At 20 photos a week, that's about $1–3 a month in Claude and up to about 240 SerpAPI credits a month, inside the 900 cap.

## Part 2: Industry column and filter
- Add an **Industry** field to search results / prospects, contacts and deals.
- Use one editable list, kept with the plans and prices settings so Seann can add industries without code changes. Start it from the Business Search type list and group the types:
  - **Pet care:** pet groomers, dog walkers, pet sitters, boarding / daycare
  - **Food:** pizzerias, restaurants, food trucks, bakeries / cafés, delis
  - **Home services:** landscapers, cleaners, handymen, plumbers, electricians, HVAC, painters, roofers, pest control, pool services
  - **Auto:** mobile detailers, auto repair, body shops, towing
  - **Beauty:** hair salons, barbers, nail salons, spas
  - **Health and fitness:** gyms, trainers, chiropractors, dentists
  - **Retail:** shops and boutiques
  - **Professional services:** accountants, insurance, real estate, lawyers
  - **Other:** typed by Seann
- **Industry vs business type:** store both the group (e.g. Home services) and the type (e.g. Landscapers). Filters work on either.
- **Filling it in:**
  - Search results get the type they were searched for.
  - Photo leads get Claude's pick from this list only, or "Other" with the words it read.
  - Existing records: fill from their search type where known, otherwise leave blank. Don't guess.
  - Seann can change it on any record.
- **Show it:** a column and a filter in Business Search results, Photo leads, Contacts and Pipeline, and in the CSV and Excel exports. Pipeline gets a filter only; don't add a column if the board has no room.

## Build order
1. Part 2 first: it's small, and Photo leads needs it.
2. Then Part 1, built and tested with `ENABLE_PHOTO_LEADS` on for Seann only.
3. Stop after each part and give Seann a short plain-language checklist to test on his phone.

## Done means
- On Seann's iPhone, **Add to Home Screen** from `/snap` gives a TownGrid Snap icon that opens straight to the camera button, with no sign-in for 90 days.
- A photo taken with airplane mode on shows "Saved on phone". With signal back, it uploads by itself.
- Test photos:
  - **A storefront:** read, matched to its Google profile, Pass 1 results filled in, an industry set.
  - **A work van** with a phone number: found by phone, and its address is NOT where the van was parked.
  - **A blurry photo:** marked Needs a look.
  - **A business already in the CRM:** marked Already in CRM.
- Approving a photo lead puts it in Contacts and Pipeline with the photo and industry. The Pre-visit brief shows the photo.
- Industry filters work in Business Search, Contacts and Pipeline, and in exports.
- Nothing is emailed or contacted automatically, and sending stays off.
