// iCal fallback constants. Generic: Airbnb, Booking.com or any other calendar that publishes an .ics feed. No vendor approval needed.
export const ICAL_ID = "ical" as const;
export const ICAL_STREAM = "import";
/** Polled every 30 minutes (the connector scan runs every 15 and uses the cron slot as its dedupe key). */
export const ICAL_POLL_CRON = "*/30 * * * *";
export const ICAL_FEED_SOURCES = ["airbnb", "booking_com", "other"] as const;
export type FeedSource = (typeof ICAL_FEED_SOURCES)[number];

/** Fetch limits (SSRF and abuse guards). */
export const FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 10_000;
export const FETCH_MAX_REDIRECTS = 3;
export const URL_MAX_LENGTH = 2048;

/** Parser limits. */
export const PARSE_MAX_EVENTS = 5000;
export const PARSE_MAX_LINE = 10_000;
export const MAX_STAY_DAYS = 366;

/** Consecutive failed fetches of one feed before the connection is flagged needs_attention and the owners are told. */
export const FAILURE_THRESHOLD = 3;
export const MAX_FEEDS_PER_WORKSPACE = 20;
/** Events that ended more than this many days ago are not imported (history is noise). */
export const IMPORT_GRACE_DAYS = 1;

/** Source label per feed kind, used in the record title. */
export const SOURCE_LABEL: Record<FeedSource, string> = { airbnb: "Airbnb", booking_com: "Booking.com", other: "Calendar" };

/** Export feed. */
export const TOKEN_BYTES = 32;               // 256 bits, base64url = 43 characters
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const EXPORT_PRODID = "-//Growth CRM//Availability//EN";
export const EXPORT_UID_DOMAIN = "availability.invalid";
export const EXPORT_MAX_EVENTS = 2000;
export const EXPORT_SUMMARY = "Not available";
