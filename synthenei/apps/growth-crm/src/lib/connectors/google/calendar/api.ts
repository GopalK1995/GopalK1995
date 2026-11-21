// Calendar API v3 client on the shared Google HTTP helper (bearer auth, backoff on quota / 5xx, classified errors).
// Only the primary calendar is used. PATCH goes as POST + method override because the shared helper speaks GET and POST.
import { googleJson, joinUrl, type GoogleHttpDeps } from "../shared/api";
import { GoogleApiError } from "../shared/errors";
import { PAGE_SIZE } from "./constants";
import { SyncTokenGone, type CalendarGateway } from "./gateway";
import type { GEvent, GEventList } from "./types";

export interface CalendarApiOpts extends GoogleHttpDeps { base: string }

export function makeCalendarApi(o: CalendarApiOpts): CalendarGateway {
  const { base, ...deps } = o;
  const ev = (id?: string) => joinUrl(base, `calendars/primary/events${id ? `/${encodeURIComponent(id)}` : ""}`);
  return {
    kind: "api",
    async profile(token) {
      const j = await googleJson<{ id?: string; timeZone?: string }>({ method: "GET", url: joinUrl(base, "calendars/primary"), token }, deps);
      return { email: (j.id ?? "").toLowerCase(), timeZone: j.timeZone };
    },
    async listEvents(i) {
      const q = new URLSearchParams({ maxResults: String(PAGE_SIZE), singleEvents: "true", showDeleted: "true" });
      if (i.pageToken) q.set("pageToken", i.pageToken);
      if (i.syncToken) q.set("syncToken", i.syncToken);
      else { if (i.timeMin) q.set("timeMin", i.timeMin); if (i.timeMax) q.set("timeMax", i.timeMax); }
      try { return await googleJson<GEventList>({ method: "GET", url: `${ev()}?${q}`, token: i.token }, deps); }
      catch (e) { if (e instanceof GoogleApiError && e.httpStatus === 410) throw new SyncTokenGone(); throw e; }
    },
    async getEvent(token, id) {
      try { return await googleJson<GEvent>({ method: "GET", url: ev(id), token }, deps); }
      catch (e) { if (e instanceof GoogleApiError && e.httpStatus === 404) return null; throw e; }
    },
    insertEvent: (token, body) => googleJson<GEvent>({ method: "POST", url: ev(), token, body }, deps),
    patchEvent: (token, id, body) => googleJson<GEvent>({ method: "POST", url: ev(id), token, body, headers: { "x-http-method-override": "PATCH" } }, deps),
  };
}
