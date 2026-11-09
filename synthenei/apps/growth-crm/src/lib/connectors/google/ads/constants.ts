// Google Ads connector constants. No customer ids, brands, prices or URLs of any tenant live here.
import type { WindowPolicy } from "../shared/dates";

export const ADS_CONNECTOR_ID = "google-ads" as const;
export const DEFAULT_ADS_API_BASE = "https://googleads.googleapis.com";
/** Google Ads API major version used in the URL path. Override with GOOGLE_ADS_API_VERSION when Google sunsets it (versions live about a year). */
export const DEFAULT_ADS_API_VERSION = "v21";

/** The daily cost sync runs from 06:00 IST. Google restates conversions for recent days, so the trailing week is re-read every run. */
export const POLICY: WindowPolicy = { afterMinutesIst: 6 * 60, lookbackDays: 7, backfillDays: 30 };
export const STREAM_DAILY = "daily" as const;

/** Google customer ids are 10 digits (shown as 123-456-7890; the API wants the digits only). */
export const CUSTOMER_ID = /^\d{10}$/;
export const cleanCustomerId = (s: string | undefined | null): string => (s ?? "").replace(/\D/g, "");
export const MAX_NAME_LEN = 200;
