# TownGrid pre-visit and pre-cold-email research

Written Nov 23, 2026. Adapted from the research method Seann used in ESyCRM for pet groomers (identity matching, website checks, owner first name, public email or contact form, evidence for every finding). The grooming-software questions are replaced with TownGrid's questions: does this business need what we sell, and what's the one concrete thing to show the owner?

**Use it two ways:**
1. **In a Claude chat (this project):** paste the prompt at the bottom with the business details filled in. Claude researches one business and returns the summary table.
2. **In the TownGrid CRM:** the same fields make up the Pre-visit brief (`claude/LEAD-FINDER-SPEC.md`, Step 4).

## What carried over from the ESyCRM method, and what changed

| ESyCRM method | For TownGrid |
|---|---|
| Confirm identity by name, address, phone and website; never merge look-alike businesses | **Keep as is.** Most important rule. |
| Inspect the business's own website (home, footer, contact, about, team, services, booking) | **Keep**, and also record: does it load, works on a phone, copyright year, request/booking form, menu or prices, online ordering, broken buttons. |
| Booking software and booking URL | **Keep for pet businesses** (ESyPet referral). For restaurants: ordering platform (own site, Slice, ChowNow, Toast, GloriaFood, delivery apps). For home services: quote or request form. |
| Owner first name with source, quote, role and "Not confirmed" when unclear | **Keep.** Used for the greeting in cold emails and for asking for the owner by name on a visit. |
| Public email with the page it appears on; never guess emails; not the web designer's or booking platform's email | **Keep as is.** |
| Contact form as the fallback, URL only, never submit | **Keep as is.** |
| Source checklist: Found / Checked, nothing useful / Blocked / Not checked | **Keep.** Never claim a source was checked if it wasn't. |
| AI answers (Google AI Overview etc.) are hints, not proof | **Keep.** |
| Spending limit before any paid search; human review before anything is sent | **Keep.** |
| "Does it offer grooming? Is it a grooming shop?" | **Replaced** with TownGrid fit questions: lead type, serves customers in person, still open, which plan fits. |
| Checks BBB, Yelp, Facebook, Nextdoor, Thumbtack, Angi pages directly | **Changed.** The CRM never opens these pages from code (their terms forbid automated access): search results only. In a chat, Claude uses search results for them; Seann opens Facebook, Instagram and Yelp himself in his browser for follower counts, last post and owner details. |
| — | **New:** Google profile check (rating, number of reviews, does the owner reply to reviews, hours, photos), social activity (hand check), delivery-app prices versus the paper menu, and the one thing to show on the phone. |

## The fields (summary table)

| Field | Finding | Evidence status |
|---|---|---|
| Business identity | name, address, phone | Matched / Uncertain / Conflicting |
| Still open? | Google status, newest review date | Open / Closed / Unknown |
| Serves customers in person? | storefront or visits customers | Yes / No / Unknown |
| Lead type | from `claude/LEAD-FINDER-SPEC.md` | |
| Website | URL or "No Website found" | + problems found (old, broken, not phone-friendly, no form) |
| Google profile | rating, reviews, owner replies to reviews?, hours, photos | Checked / Not checked |
| Facebook / Instagram | links or "No social found" | Likely match: Seann to check followers and last post |
| Booking / ordering | platform and URL, delivery apps | Identified / None found / Unknown |
| Delivery buttons on own website | which services (DoorDash, Uber Eats, Grubhub, Seamless, Slice…) the site links to, with the page | Found / None found / Unknown |
| **Owner first name** | name as published, role | Supported / Suggested / Not confirmed |
| **Public email** | exact address + page URL | Found / Not found in checked sources |
| **Contact form** | URL, general or booking form | Found / Not found / Unverified |
| Phone | | |
| Best-fit TownGrid plan | Get Seen, Plus, ordering plan, or ESyPet referral | |
| One thing to show the owner | e.g. stale delivery-app prices, no website, unanswered reviews, wrong hours | with source |
| Likely objection and answer | from `claude/SALES-PITCHES.md` | |

Then: evidence (URLs and short quotes), source checklist, uncertainties, number of searches and pages used, and the recommended next step (visit, cold email, call, or skip).

## Rules
- **Always search the business name plus its full street address first** (for example "Lorenzo's Pizzeria, 21 Cedar Swamp Rd"), the way Google does. Only call a website "No Website found" after that search and a name + town search both come up empty. (Added Nov 23: a quick pass missed Lorenzo's website because it skipped this.)
- **A website "Empowered by Slice" (or built by ChowNow, Toast, Owner.com etc.) is the ordering company's site, not one the owner controls.** Record the platform; the lead type is "Own ordering already" through that platform.
- A search result is a lead to check, not proof. Match name and town or phone before accepting it.
- Never guess an email address or a surname. "Not confirmed" is a fine answer.
- An employee, groomer, cook, reviewer or customer is not the owner unless ownership is stated.
- A page that won't load is "Blocked", not "No".
- **Check that it's still open before anything else.** Google's AI Overview (which Claude's own web tools usually can't see; Seann can paste or screenshot it) and Google's "Permanently closed" label are the fastest signs. Treat the AI Overview as a hint and confirm with the Google listing. If every source found is years old, treat the business as possibly closed.
- No paid tools beyond the budget given. No budget given = no paid tools.
- Never contact the business, submit a form, add it to the CRM or start a sequence as part of research.
- Cold emails greet the owner by first name only when the name is "Supported". Otherwise "Hi [Business Name] team".

## The prompt to paste (fill in the bottom)

```
Research this business for TownGrid using claude/PRE-VISIT-RESEARCH.md.
Return the summary table first (owner first name, public email and contact form
prominent), then evidence, source checklist, uncertainties, usage, and the
recommended next step. Use claude/SALES-PITCHES.md for the "one thing to show"
and the likely objection. Don't contact the business or change anything.

Business name:
Full address:
Type of business:
Known website:
Known phone:
Known Facebook / Instagram:
Visit or cold email:
Paid-tool budget: none
```
