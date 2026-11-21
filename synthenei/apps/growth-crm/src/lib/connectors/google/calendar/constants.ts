// Google Calendar connector constants. Nothing tenant-, brand-, calendar-id- or URL-specific of a customer lives here.
export const CALENDAR_CONNECTOR_ID = "google-calendar" as const;
/** Sensitive scope (not restricted): read and write events on the calendars the user can edit. */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const CALENDAR_ENV = { apiBase: "GOOGLE_CALENDAR_API_BASE" } as const;
export const DEFAULT_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

export const STREAM_PULL = "pull" as const;
export const STREAM_PUSH = "push" as const;
export const PAGE_SIZE = 250;
export const LOOKBACK_DAYS = 30;
export const LOOKAHEAD_DAYS = 365;
/** Most local events pushed to Google per step (a backlog continues on the next page of the run). */
export const PUSH_BATCH = 50;
export const MAX_TITLE = 300;

/** Private extended properties the CRM stamps on the events it creates; they carry the link back to the CRM record. */
export const PROP = { kind: "crm_kind", objectType: "crm_object_type", objectId: "crm_object_id" } as const;
export const EVENT_KINDS = ["demo", "meeting", "room_hold"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
