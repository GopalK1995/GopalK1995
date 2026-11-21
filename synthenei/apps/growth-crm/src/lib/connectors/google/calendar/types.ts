// Shapes shared by the calendar mapper, gateways, store and sync. Pure types.
import type { EventKind } from "./constants";

export interface GTime { date?: string; dateTime?: string; timeZone?: string }
export interface GEvent {
  id: string; status?: string; summary?: string; updated?: string; visibility?: string;
  start?: GTime; end?: GTime;
  attendees?: { email?: string; self?: boolean; resource?: boolean }[];
  extendedProperties?: { private?: Record<string, string> };
}
export interface GEventList { items: GEvent[]; nextPageToken?: string; nextSyncToken?: string; timeZone?: string }
export type CalStatus = "confirmed" | "tentative" | "cancelled";
export type ObjectRef = { type: string; id: string };

/** A calendar_events row as the sync sees it. */
export interface CalRow {
  externalId: string; startsAt: string; endsAt: string; title: string; status: CalStatus;
  objectType: string | null; objectId: string | null; kind: EventKind | null; remoteUpdated: string | null;
}
export interface LocalEvent {
  id: string; externalId: string | null; integrationId: string | null; startsAt: string; endsAt: string; title: string;
  status: CalStatus; objectType: string | null; objectId: string | null; updatedAt: string;
}
export interface Existing { id: string; updatedAt: string; sig: string }
