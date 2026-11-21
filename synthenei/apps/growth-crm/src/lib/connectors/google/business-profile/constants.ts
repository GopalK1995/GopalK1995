// Google Business Profile connector constants. No account, location, brand, price or URL of any tenant lives here; the vendor hosts are
// Google's public API hosts, overridable by env name (values in the deployment).
import type { WindowPolicy } from "../shared/dates";

export const GBP_CONNECTOR_ID = "google-business" as const;
export const STREAM_REVIEWS = "reviews" as const;
export const STREAM_PERFORMANCE = "performance" as const;

/** The one Business Profile scope (read and manage listings and reviews; Google offers no read-only variant). */
export const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";

export const GBP_ENV = {
  accountsApiBase: "GBP_ACCOUNTS_API_BASE",
  infoApiBase: "GBP_INFO_API_BASE",
  performanceApiBase: "GBP_PERFORMANCE_API_BASE",
  reviewsApiBase: "GBP_REVIEWS_API_BASE",
} as const;
export const DEFAULT_ACCOUNTS_BASE = "https://mybusinessaccountmanagement.googleapis.com/v1";
export const DEFAULT_INFO_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
export const DEFAULT_PERFORMANCE_BASE = "https://businessprofileperformance.googleapis.com/v1";
/** Reviews are still served by the v4 My Business API (Google has not moved them to a newer one). */
export const DEFAULT_REVIEWS_BASE = "https://mybusiness.googleapis.com/v4";

/** Credential-bundle keys chosen at listing selection (ids, not secrets). */
export const GBP_CRED = { account: "gbp_account", location: "gbp_location" } as const;

/** Resource ids are numeric in Google's names (accounts/123, locations/456). */
export const RESOURCE_ID = /^\d{1,32}$/;
export const cleanResourceId = (s: string | undefined | null): string => (s ?? "").trim().replace(/^(accounts|locations)\//, "");
export const MAX_NAME_LEN = 200;
export const MAX_REPLY_LEN = 4096;   // reviews.reply_draft check; Google's own limit is 4096 too
export const REVIEW_PAGE_SIZE = 50;
/** Pages read per run step; the cursor resumes after that. */
export const REVIEW_PAGES_PER_STEP = 5;

/**
 * Performance data trails by about two days, so the window always ends two days back: an `afterMinutesIst` past the end of the day is never
 * reached and planWindow keeps its "day before yesterday" end. The trailing week is re-read because Google restates it.
 */
export const PERFORMANCE_POLICY: WindowPolicy = { afterMinutesIst: 24 * 60 + 1, lookbackDays: 7, backfillDays: 90 };

/** DailyMetric enum names of the Business Profile Performance API, grouped into the stored columns. */
export const METRIC = {
  searchDesktop: "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", searchMobile: "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  mapsDesktop: "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", mapsMobile: "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  calls: "CALL_CLICKS", website: "WEBSITE_CLICKS", directions: "BUSINESS_DIRECTION_REQUESTS",
  conversations: "BUSINESS_CONVERSATIONS", bookings: "BUSINESS_BOOKINGS", foodOrders: "BUSINESS_FOOD_ORDERS",
} as const;
export const ALL_METRICS: string[] = Object.values(METRIC);
