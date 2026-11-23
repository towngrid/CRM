import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { SalonFetchRuntime } from "./salonPublicFetch";
import { buildGoogleMapsParams, crawlWebsite, parseGoogleMapsResults } from "./lead-discovery";
import { strongMatch } from "./salonEnrichment";
import { bookingPlatformForUrl, extractSalonEmailFromBookingHtml, findSalonEmailOnBookingPage, importableSalonEmail, importableSalonEmailCandidate } from "./bookingPageEmail";
import { allReportPlaceIdsExist, canApproveSalonReportRow, convertSalonSearchReportEntry, duplicateReportPlaceIds, reportPlaceIdsAreDistinct, salonReportScheduleRejection, salonReportSendRejection, salonSearchReportBatchSchema } from "./salonSearchReport";

const row = {
  businessName: "Paws Grooming",
  placeId: "ChIJsamplePlaceId",
  address: "12 Main Street, Austin, TX 78701",
  address1: "12 Main Street",
  city: "Austin",
  state: "TX",
  zipCode: "78701",
};

function mockedSalonRuntime(): SalonFetchRuntime {
  return {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    request: async url => {
      const response = await globalThis.fetch(url.href, { redirect: "manual" });
      return {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers.entries()), "content-type": "text/html" },
        body: await response.text(),
      };
    },
  };
}

test("Place ID lookup uses the exact ID without a broad search query", () => {
  const params = buildGoogleMapsParams("test-key", '"Paws Grooming"', "78701", row.placeId);
  assert.equal(params.get("engine"), "google_maps");
  assert.equal(params.get("type"), "place");
  assert.equal(params.get("place_id"), row.placeId);
  assert.equal(params.has("q"), false);
});

test("rows without Place IDs retain the existing Google Maps search", () => {
  const params = buildGoogleMapsParams("test-key", '"Paws Grooming"', "78701");
  assert.equal(params.get("type"), "search");
  assert.equal(params.get("q"), '"Paws Grooming" 78701');
  assert.equal(params.has("place_id"), false);
});

test("a Place Details response supplies the official website and phone", () => {
  const [place] = parseGoogleMapsResults({
    place_results: {
      title: "Paws Grooming",
      address: "12 Main Street Austin TX 78701",
      place_id: row.placeId,
      data_id: "0x123:0x456",
      website: "https://paws.example",
      phone: "(512) 555-0134",
    },
  });
  assert.equal(place.placeId, row.placeId);
  assert.equal(place.link, "https://paws.example");
  assert.equal(place.phone, "(512) 555-0134");
  assert.equal(strongMatch(row, place), true);
});

test("a provider data_id is never mistaken for a Google Place ID", () => {
  const [place] = parseGoogleMapsResults({
    place_results: {
      title: row.businessName,
      address: row.address,
      data_id: "0x123:0x456",
    },
  });
  assert.equal(place.placeId, undefined);
  assert.equal(strongMatch(row, place), true); // name and address, not ID
});

test("matching Place IDs establish the business identity", () => {
  assert.equal(strongMatch(row, {
    title: "Paws Grooming LLC",
    address: "12 Main St, Austin TX 78701",
    placeId: row.placeId,
  }), true);
});

test("a conflicting Place ID is rejected even if the name and address match", () => {
  assert.equal(strongMatch(row, {
    title: row.businessName,
    address: row.address,
    placeId: "ChIJotherPlace",
  }), false);
});

test("a listing without a Place ID needs a strong name and address match", () => {
  assert.equal(strongMatch(row, {
    title: "Paws Grooming",
    address: "12 Main Street Austin TX 78701",
  }), true);
  assert.equal(strongMatch(row, {
    title: "Another Pet Store",
    address: "12 Main Street Austin TX 78701",
  }), false);
});

test("a hosted booking link is not mistaken for the salon's website", () => {
  assert.equal(bookingPlatformForUrl("https://groomer.io/request/4furm"), "Groomer.io");
  assert.equal(bookingPlatformForUrl("https://www.booksy.com/en-us/123"), "Booksy");
  assert.equal(bookingPlatformForUrl("https://www.my-grooming-salon.example/contact"), null);
  assert.equal(bookingPlatformForUrl("https://notbooksy.com/contact"), null);
});

const bookingUrl = "https://groomer.io/request/4furm";

test("salon email on a matching booking page can be reviewed for import", () => {
  const html = `<body><h1>DoggyStyle Salon</h1><main>
    <a href="mailto:hello@doggystylesalon.com">Email the salon</a>
    </main><footer>support@groomer.io</footer></body>`;
  const email = extractSalonEmailFromBookingHtml(html, "Doggy Style Salon", bookingUrl);
  assert.equal(email, "hello@doggystylesalon.com");
  const row = {
    email, bookingUrl, websiteUrl: null, identityMatchStatus: "strong", reviewStatus: "approved",
    evidence: { email: { value: email, source: "booking_page", confidence: "medium", sourceUrl: bookingUrl } },
  } as Parameters<typeof importableSalonEmail>[0];
  assert.equal(importableSalonEmail(row), email);
  assert.equal(importableSalonEmail({ ...row, reviewStatus: "needs_review" }), null);
  assert.equal(importableSalonEmail({ ...row, bookingUrl: "https://booksy.com/another-salon" }), null);
  assert.equal(importableSalonEmail({ ...row, email: "different@doggystylesalon.com" }), null);
});

test("an approved email from a matched alternate salon website can be imported", () => {
  const email = "hello@pawssalon.example";
  const sourceUrl = "https://pawssalon.example/contact";
  const emailEvidence = { value: email, source: "serp_fallback_website", confidence: "medium", sourceUrl };
  const row = {
    email, websiteUrl: "https://pawssalon.example/", bookingUrl: null,
    identityMatchStatus: "strong", reviewStatus: "approved",
    evidence: { email: emailEvidence },
  } as Parameters<typeof importableSalonEmail>[0];
  assert.equal(importableSalonEmail(row), email);
  assert.equal(importableSalonEmail({ ...row, reviewStatus: "needs_review" }), null);
  assert.equal(importableSalonEmail({ ...row, identityMatchStatus: "unmatched" }), null);
  assert.equal(importableSalonEmail({ ...row, email: "another@pawssalon.example" }), null);
  assert.equal(importableSalonEmail({ ...row, evidence: { email: { ...emailEvidence, sourceUrl: "https://book.cuddlesapp.com/salon" } } }), null);
  assert.equal(importableSalonEmail({ ...row, evidence: { email: { ...emailEvidence, sourceUrl: "http://pawssalon.example" } } }), null);
  assert.equal(importableSalonEmail({ ...row, evidence: { email: { ...emailEvidence, purpose: "booking_only" } } }), null);
});

test("salon public-web report entries convert to reviewed but not yet approved import candidates", () => {
  const [entry] = salonSearchReportBatchSchema.parse({
    name: "Reviewed list",
    reviewed: [{
      State: "TX",
      Business: "Paws Grooming",
      "Source address": "12 Main Street, Austin, TX 78701",
      "Google Place ID": "place-report-1",
      Outcome: "verified_first_party_email",
      "Public email (review-only when marked)": "hello@pawsgrooming.example",
      "Email evidence URL": "https://pawsgrooming.example/contact",
      "Email use": "Public business contact — manual review before any import/outreach",
      "Evidence and exceptions": "Current salon page shows the address, grooming service and public inbox.",
    }],
  }).reviewed;
  const row = convertSalonSearchReportEntry(entry, 1) as any;
  assert.equal(row.businessName, "Paws Grooming");
  assert.equal(row.address, entry["Source address"]);
  assert.equal(row.state, "TX");
  assert.equal(row.sourceData.category, "verified_public_email");
  assert.equal(row.email, "hello@pawsgrooming.example");
  assert.equal(row.identityMatchStatus, "strong");
  assert.equal(row.status, "enriched");
  assert.equal(row.reviewStatus, "needs_review");
  assert.equal(row.evidence.note, entry["Evidence and exceptions"]);
  assert.equal(row.evidence.sourceUrl, entry["Email evidence URL"]);
  assert.equal(importableSalonEmailCandidate(row), row.email);
  assert.equal(importableSalonEmail(row), null);
  assert.equal(canApproveSalonReportRow(row), true);
  assert.equal(importableSalonEmail({ ...row, reviewStatus: "approved" }), row.email);

  const reviewOnly = convertSalonSearchReportEntry({
    ...entry,
    Outcome: "review_only_candidate",
  }, 2) as any;
  assert.equal(reviewOnly.email, null);
  assert.equal(reviewOnly.sourceData.category, "review_only");
  assert.equal(reviewOnly.status, "rejected");
  assert.equal(reviewOnly.reviewStatus, "needs_review");
  assert.equal(canApproveSalonReportRow(reviewOnly), false);
});

test("report conversion rejects booking-only, non-grooming, and incomplete public email evidence", () => {
  const entry = {
    State: "NY",
    Business: "Example Grooming",
    "Source address": "1 Main St, New York, NY",
    "Google Place ID": "place-report-2",
    Outcome: "verified_first_party_email" as const,
    "Public email (review-only when marked)": "book@example.com",
    "Email evidence URL": "https://example.com/contact",
    "Email use": "Booking-only appointment requests",
    "Evidence and exceptions": "Email is only for appointment booking.",
  };
  const booking = convertSalonSearchReportEntry(entry, 1) as any;
  assert.equal(booking.email, null);
  assert.equal(booking.reviewStatus, "rejected");
  assert.equal(booking.identityMatchStatus, "unmatched");
  assert.equal(importableSalonEmailCandidate(booking), null);
  const restrictedUse = convertSalonSearchReportEntry({
    ...entry,
    "Email use": "Bookings/customer appointments only — not general outreach",
  }, 4) as any;
  assert.equal(restrictedUse.sourceData.category, "booking_only");
  assert.equal(restrictedUse.email, null);
  const nonGrooming = convertSalonSearchReportEntry({
    ...entry,
    Outcome: "excluded_non_grooming",
  }, 2) as any;
  assert.equal(nonGrooming.email, null);
  assert.equal(nonGrooming.sourceData.category, "non_grooming");
  assert.equal(nonGrooming.reviewStatus, "rejected");
  const httpEvidence = convertSalonSearchReportEntry({
    ...entry,
    "Email use": "Public business contact — manual review before any import/outreach",
    "Email evidence URL": "http://example.com/contact",
  }, 3) as any;
  assert.equal(httpEvidence.email, null);
});

test("salon search report rejects Place ID overlap within and across batches", () => {
  assert.deepEqual(
    duplicateReportPlaceIds(["Place-A", "place-b", "Place-C"], ["PLACE-A", "place-c"]),
    ["Place-A", "Place-C"],
  );
  const repeated = salonSearchReportBatchSchema.safeParse({
    name: "duplicate IDs",
    reviewed: [{
      State: "CA", Business: "One", "Source address": "1 Main St", "Google Place ID": "same",
      Outcome: "no_verified_email", "Evidence and exceptions": "No email found.",
    }, {
      State: "CA", Business: "Two", "Source address": "2 Main St", "Google Place ID": "SAME",
      Outcome: "no_verified_email", "Evidence and exceptions": "No email found.",
    }],
  });
  assert.equal(repeated.success, true); // Row validation is separate from the route's distinct-ID check.
  assert.equal(reportPlaceIdsAreDistinct(["same", "SAME"]), false);
  assert.equal(reportPlaceIdsAreDistinct(["same", "other"]), true);
  assert.equal(allReportPlaceIdsExist(["a", "b"], ["A", "b", "c"]), true);
  assert.equal(allReportPlaceIdsExist(["a", "missing"], ["a"]), false);
});

test("public-web email policy requires exact email, strong identity, general use, and HTTPS evidence", () => {
  const email = "hello@paws.example";
  const row = {
    email,
    websiteUrl: null,
    bookingUrl: null,
    identityMatchStatus: "strong",
    reviewStatus: "approved",
    sourceData: { Outcome: "verified_independent_directory_email" },
    evidence: {
      email: {
        value: email,
        source: "public_web_review",
        confidence: "high",
        sourceUrl: "https://paws.example/contact",
        purpose: "general",
      },
    },
  } as any;
  assert.equal(importableSalonEmail(row), email);
  assert.equal(importableSalonEmail({ ...row, reviewStatus: "needs_review" }), null);
  assert.equal(importableSalonEmail({ ...row, evidence: { email: { ...row.evidence.email, purpose: "booking_only" } } }), null);
  assert.equal(importableSalonEmail({ ...row, evidence: { email: { ...row.evidence.email, sourceUrl: "http://paws.example/contact" } } }), null);
  assert.equal(importableSalonEmail({ ...row, email: "different@paws.example" }), null);
  assert.equal(importableSalonEmail({ ...row, identityMatchStatus: "ambiguous" }), null);
});

test("salon report scheduling guard requires owned email contact, deal, directory step 1, matching track, and future time", () => {
  const now = new Date("2030-01-01T00:00:00.000Z");
  const valid = {
    row: {
      status: "imported",
      importedContactId: "contact-1",
      audienceTrack: "directory_general",
      email: "salon@example.com",
      identityMatchStatus: "strong",
      reviewStatus: "approved",
      websiteUrl: null,
      bookingUrl: null,
      sourceData: {
        category: "verified_public_email",
        Outcome: "verified_first_party_email",
        "Public email (review-only when marked)": "salon@example.com",
      },
      evidence: {
        email: {
          value: "salon@example.com",
          source: "public_web_review",
          confidence: "high",
          sourceUrl: "https://salon.example/contact",
          purpose: "general",
        },
      },
    },
    contact: { userId: "owner-1", email: "salon@example.com", sequenceTrack: "directory_general" },
    sequence: { userId: "owner-1", sequenceTrack: "directory_general", sequenceNumber: 1, isActive: "true" },
    userId: "owner-1",
    hasOwnedDeal: true,
    scheduledSendAt: new Date("2030-01-02T00:00:00.000Z"),
    now,
  };
  assert.equal(salonReportScheduleRejection(valid), null);
  assert.match(salonReportScheduleRejection({ ...valid, hasOwnedDeal: false }) || "", /pipeline deal/);
  assert.match(salonReportScheduleRejection({
    ...valid, contact: { ...valid.contact, userId: "other-user" },
  }) || "", /owned contact/);
  assert.match(salonReportScheduleRejection({
    ...valid, sequence: { ...valid.sequence, sequenceNumber: 2 },
  }) || "", /step 1/);
  assert.match(salonReportScheduleRejection({
    ...valid, contact: { ...valid.contact, email: null },
  }) || "", /email address/);
  assert.match(salonReportScheduleRejection({
    ...valid, scheduledSendAt: new Date("2030-01-01T00:00:00.000Z"),
  }) || "", /future date/);
  assert.match(salonReportScheduleRejection({
    ...valid,
    row: { ...valid.row, reviewStatus: "needs_review" },
  }) || "", /remain approved/);
  assert.match(salonReportScheduleRejection({
    ...valid,
    contact: { ...valid.contact, email: "edited@example.com" },
  }) || "", /matching the contact/);
});

test("scheduler send guard blocks edited emails and revoked report approvals", () => {
  const row = {
    userId: "owner-1",
    status: "imported",
    reviewStatus: "approved",
    identityMatchStatus: "strong",
    email: "salon@example.com",
    websiteUrl: null,
    bookingUrl: null,
    sourceData: {
      category: "verified_public_email",
      Outcome: "verified_first_party_email",
      "Public email (review-only when marked)": "salon@example.com",
    },
    evidence: {
      email: {
        value: "salon@example.com",
        source: "public_web_review",
        confidence: "high",
        sourceUrl: "https://salon.example/contact",
        purpose: "general",
      },
    },
  } as any;
  const contact = { userId: "owner-1", email: "salon@example.com" };
  assert.equal(salonReportSendRejection(row, contact, "owner-1"), null);
  assert.match(salonReportSendRejection(row, { ...contact, email: "edited@example.com" }, "owner-1") || "", /no longer matches/);
  assert.match(salonReportSendRejection({ ...row, reviewStatus: "rejected" }, contact, "owner-1") || "", /approval was revoked/);
});

test("booking providers and unrelated salons cannot supply a sequence email", () => {
  const boilerplate = `<body><h1>DoggyStyle Salon</h1><main>Book now</main>
    <script>const email="owner@doggystylesalon.com"</script>
    <footer><a href="mailto:support@groomer.io">Help</a></footer></body>`;
  assert.equal(extractSalonEmailFromBookingHtml(boilerplate, "Doggy Style Salon", bookingUrl), null);
  assert.equal(extractSalonEmailFromBookingHtml(
    `<body><h1>Another Salon</h1><p>owner@doggystylesalon.com</p></body>`,
    "Doggy Style Salon", bookingUrl,
  ), null);
  assert.equal(extractSalonEmailFromBookingHtml(
    `<body><h1>DoggyStyle Salon</h1><p>support@groomer.io</p></body>`,
    "Doggy Style Salon", bookingUrl,
  ), null);
});

test("booking email lookup requests only the exact page and never follows a redirect", async () => {
  const originalFetch = globalThis.fetch;
  const visited: string[] = [];
  try {
    globalThis.fetch = async (input) => {
      visited.push(String(input));
      return new Response(`<body><h1>DoggyStyle Salon</h1><p>salon@doggystylesalon.com</p></body>`, {
        headers: { "content-type": "text/html" },
      });
    };
    assert.equal(await findSalonEmailOnBookingPage(bookingUrl, "Doggy Style Salon"), "salon@doggystylesalon.com");
    assert.deepEqual(visited, [bookingUrl]);
    globalThis.fetch = async (input) => {
      visited.push(String(input));
      return new Response(null, { status: 302, headers: { location: "https://groomer.io/contact" } });
    };
    assert.equal(await findSalonEmailOnBookingPage(bookingUrl, "Doggy Style Salon"), null);
    assert.deepEqual(visited, [bookingUrl, bookingUrl]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a site-builder image beside grooming copy is not a booking link", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(`<body><h1>Felix's Pet Grooming</h1>
      <p>Book your grooming appointment by calling 323-585-2670.</p>
      <img src="https://sites.google.com/sitesv-images-rt/image-id">
      <section><h2>Opening Hours</h2><p>Monday – Appointment Only</p></section>
      <section><h2>Contact</h2><p>felixdoggrooming@gmail.com</p></section></body>`, {
      headers: { "content-type": "text/html" },
    });
    const result = await crawlWebsite("https://sites.google.com/view/felixspetgrooming/home", { runtime: mockedSalonRuntime() });
    assert.equal(result.email, "felixdoggrooming@gmail.com");
    assert.equal(result.bookingUrl, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a Google Sites redirect to a salon booking page keeps the destination", async () => {
  const originalFetch = globalThis.fetch;
  const destination = "https://book.cuddlesapp.com/felix-s-pet-grooming";
  try {
    globalThis.fetch = async () => new Response(`<body><h1>Felix's Pet Grooming</h1>
      <a href="https://www.google.com/url?q=https%3A%2F%2Fbook.cuddlesapp.com%2Ffelix-s-pet-grooming&amp;sa=D">Book now</a>
      <p>felixdoggrooming@gmail.com — 323-585-2670</p></body>`);
    const result = await crawlWebsite("https://sites.google.com/view/felixspetgrooming/home", { runtime: mockedSalonRuntime() });
    assert.equal(result.bookingUrl, destination);
    assert.equal(result.softwareName, "CuddlesApp");
    assert.equal(bookingPlatformForUrl(destination), "CuddlesApp");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a contact link without a message form is not a contact-form candidate", async () => {
  const originalFetch = globalThis.fetch;
  const visited: string[] = [];
  try {
    globalThis.fetch = async input => {
      const url = String(input);
      visited.push(url);
      if (url === "https://paws.example/") {
        return new Response(`<a href="/contact">Contact us</a>
          <a href="https://other.example/contact">Contact elsewhere</a>
          <p>hello@paws.example</p><p>(512) 555-0134</p>`);
      }
      return new Response(`<h1>Contact us</h1><p>Call us at (512) 555-0134</p>`);
    };
    const result = await crawlWebsite("https://paws.example/", { runtime: mockedSalonRuntime() });
    assert.equal(result.contactFormUrl, undefined);
    assert.deepEqual(visited, ["https://paws.example/", "https://paws.example/contact", "https://paws.example/contact/"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a same-origin contact page with a message field and submit is a candidate", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async input => String(input) === "https://paws.example/"
      ? new Response(`<a href="/contact-us">Contact</a>
          <p>hello@paws.example</p><p>(512) 555-0134</p>`)
      : new Response(`<h1>Contact us</h1><form action="/send">
          <label for="message">Message</label><textarea id="message" name="message"></textarea>
          <button type="submit">Send message</button>
        </form>`);
    const result = await crawlWebsite("https://paws.example/", { runtime: mockedSalonRuntime() });
    assert.equal(result.contactFormUrl, "https://paws.example/contact-us");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a general inquiry form on the salon homepage is a candidate", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(`<h1>Welcome to Paws Grooming</h1>
      <form><label>Your message <textarea name="message"></textarea></label>
      <button type="submit">Send</button></form>`);
    const result = await crawlWebsite("https://paws.example/", { runtime: mockedSalonRuntime() });
    assert.equal(result.contactFormUrl, "https://paws.example/");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an appointment request form with a message field is not a general inquiry candidate", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async input => String(input) === "https://paws.example/"
      ? new Response(`<a href="/contact">Contact</a>
          <p>hello@paws.example</p><p>(512) 555-0134</p>`)
      : new Response(`<h1>Book an appointment</h1><form>
          <label>Appointment date <input type="date" name="date"></label>
          <textarea name="message" placeholder="Notes for your appointment"></textarea>
          <button type="submit">Request appointment</button>
        </form>`);
    const result = await crawlWebsite("https://paws.example/", { runtime: mockedSalonRuntime() });
    assert.equal(result.contactFormUrl, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});