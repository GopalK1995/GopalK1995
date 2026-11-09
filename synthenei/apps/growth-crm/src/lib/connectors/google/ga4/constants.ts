// GA4 connector constants. No property ids, brands or URLs of any tenant live here.
import type { WindowPolicy } from "../shared/dates";

export const GA4_CONNECTOR_ID = "ga4" as const;
export const DEFAULT_DATA_API_BASE = "https://analyticsdata.googleapis.com/v1beta";
export const DEFAULT_ADMIN_API_BASE = "https://analyticsadmin.googleapis.com/v1beta";

/** Report dimensions, in the order requested. The ga4_daily key is day + channel group + source/medium + device + city + landing page. */
export const DIMENSIONS = ["date", "sessionDefaultChannelGroup", "sessionSourceMedium", "deviceCategory", "city", "landingPage", "sessionCampaignName"] as const;
/** `keyEvents` is the current name of what GA4 called conversions until 2024. userEngagementDuration is total seconds. */
export const METRICS = ["sessions", "engagedSessions", "totalUsers", "newUsers", "userEngagementDuration", "keyEvents"] as const;

/** Rows per runReport page (the API allows up to 250,000; smaller pages keep a run resumable and inside the job deadline). */
export const REPORT_PAGE_SIZE = 10_000;
/** The daily report runs from 05:30 IST (GA4 finalises the previous day overnight). The stream slot is hourly; the step decides. */
export const POLICY: WindowPolicy = { afterMinutesIst: 5 * 60 + 30, lookbackDays: 3, backfillDays: 90 };
export const MAX_FIELD_LEN = 200;
export const STREAM_DAILY = "daily" as const;
