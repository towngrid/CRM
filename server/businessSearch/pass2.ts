// Pass 2: the Google profile check (Step 3c), only for businesses scoring 40+ (the tier B line).
// SerpAPI lookups per business, each 1 credit (0 if answered from the 30-day cache):
//   1. Google Maps place details: "unclaimed_listing" and the newest "From the owner" posts
//   2. Reviews, newest first: owner replies, unanswered 1–2 star reviews, newest review date
//   3. Photos in the "By owner" category: how many (Google doesn't give photo dates)
//   4. Only when the place details list no post dates but link to posts: the posts list
// Search results only: no Google page is opened from code.
import { eq } from "drizzle-orm";
import { db } from "../db";
import { businessLeads, type BusinessLead } from "@shared/schema";
import { serpRequest } from "./serp";

export interface Pass2Findings {
  at: string;
  unclaimed: boolean;
  /** Owner replies among the newest (up to) 10 reviews. */
  ownerRepliesOfNewest10: number;
  reviewsChecked: number;
  /** Whether any review came back with an owner-reply field at all (checks the field exists). */
  replyFieldSeen: boolean;
  unansweredBadReview: boolean;
  newestReviewDate: string | null;
  /** Newest Google "Updates" post; null = no posts found. */
  newestUpdateDate: string | null;
  postsFound: number;
  /** Photos in Google's "By owner" category (first page, up to 10). */
  ownerPhotoCount: number;
  /** e.g. "Confirmed by this business 4 weeks ago" */
  hoursLastUpdated: string | null;
  lookups: number;
}

const BY_OWNER = "CgIgARICEAE";

function toIso(text: unknown): string | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function newest(dates: (string | null)[]): string | null {
  const ok = dates.filter((d): d is string => !!d).sort();
  return ok.length ? ok[ok.length - 1] : null;
}

function hasOwnerReply(review: any): boolean {
  const r = review?.response ?? review?.owner_response ?? review?.reply;
  return !!(r && (r.snippet || r.text || r.date || r.iso_date || typeof r === "string"));
}

export function readReviews(reviews: any[]): Pick<Pass2Findings, "ownerRepliesOfNewest10" | "reviewsChecked" | "replyFieldSeen" | "unansweredBadReview" | "newestReviewDate"> {
  const newest10 = reviews.slice(0, 10);
  return {
    ownerRepliesOfNewest10: newest10.filter(hasOwnerReply).length,
    reviewsChecked: newest10.length,
    replyFieldSeen: newest10.some(r => r && ("response" in r || "owner_response" in r)),
    unansweredBadReview: newest10.some(r => typeof r?.rating === "number" && r.rating <= 2 && !hasOwnerReply(r)),
    newestReviewDate: newest(newest10.map(r => toIso(r?.iso_date) ?? null)),
  };
}

export function readPostDates(posts: any[]): string[] {
  return posts.map(p => toIso(p?.posted_at) ?? toIso(p?.date)).filter((d): d is string => !!d);
}

export async function runPass2(lead: BusinessLead): Promise<Pass2Findings> {
  let lookups = 0;
  const call = async (params: Record<string, string>) => { lookups++; return serpRequest(lead.searchId, { hl: "en", gl: "us", ...params }); };

  // 1. Place details
  const placeParams: Record<string, string> = lead.googlePlaceId
    ? { engine: "google_maps", type: "place", place_id: lead.googlePlaceId }
    : { engine: "google_maps", type: "place", data_cid: String(((lead.mapsResult ?? {}) as any).data_cid ?? "") };
  const place = (await call(placeParams))?.place_results ?? {};
  const dataId: string | null = lead.googleDataId ?? place.data_id ?? null;

  // Posts: from the place details first; the separate posts list only if needed.
  let postDates = readPostDates(Array.isArray(place.posts) ? place.posts : []);
  let postsFound = Array.isArray(place.posts) ? place.posts.length : 0;
  if (!postDates.length && dataId && place.serpapi_posts_link) {
    const posts = (await call({ engine: "google_maps_posts", data_id: dataId }))?.posts ?? [];
    postDates = readPostDates(posts);
    postsFound = posts.length;
  }

  // 2. Reviews, newest first
  let reviewInfo = readReviews([]);
  if (dataId || lead.googlePlaceId) {
    const reviews = (await call({ engine: "google_maps_reviews", sort_by: "newestFirst", ...(dataId ? { data_id: dataId } : { place_id: lead.googlePlaceId! }) }))?.reviews ?? [];
    reviewInfo = readReviews(reviews);
  }

  // 3. "By owner" photos
  let ownerPhotoCount = 0;
  if (dataId) {
    ownerPhotoCount = ((await call({ engine: "google_maps_photos", data_id: dataId, category_id: BY_OWNER }))?.photos ?? []).length;
  }

  return {
    at: new Date().toISOString(),
    unclaimed: place.unclaimed_listing === true,
    ...reviewInfo,
    newestUpdateDate: newest(postDates),
    postsFound,
    ownerPhotoCount,
    hoursLastUpdated: typeof place.hours_last_updated === "string" ? place.hours_last_updated : null,
    lookups,
  };
}

export async function savePass2(lead: BusinessLead, pass2: Pass2Findings): Promise<void> {
  const findings = { ...((lead.findings ?? {}) as any), pass2 };
  await db.update(businessLeads).set({ findings }).where(eq(businessLeads.id, lead.id));
}
