// The seam between calendar sync logic and Google. api.ts = Calendar API v3, mock.ts = Showcase (no network). The token is passed per
// call because one connection carries several users' grants.
import type { GEvent, GEventList } from "./types";

export class SyncTokenGone extends Error { constructor() { super("sync token expired"); this.name = "SyncTokenGone"; } }

export interface ListInput { token: string; syncToken?: string; pageToken?: string; timeMin?: string; timeMax?: string }
export interface CalendarGateway {
  readonly kind: "api" | "mock";
  /** The user's primary calendar: address and time zone. */
  profile(token: string): Promise<{ email: string; timeZone?: string }>;
  /** Throws SyncTokenGone on HTTP 410 (the caller restarts with a full window). */
  listEvents(i: ListInput): Promise<GEventList>;
  /** null when the event no longer exists. */
  getEvent(token: string, id: string): Promise<GEvent | null>;
  insertEvent(token: string, body: Record<string, unknown>): Promise<GEvent>;
  patchEvent(token: string, id: string, body: Record<string, unknown>): Promise<GEvent>;
}
