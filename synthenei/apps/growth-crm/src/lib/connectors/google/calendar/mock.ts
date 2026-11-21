// Showcase gateway: a small in-memory calendar, no network. Events are CRM-stamped so they import without any contact data.
import { PROP } from "./constants";
import type { CalendarGateway } from "./gateway";
import type { GEvent } from "./types";

export function makeMockCalendar(now: () => Date = () => new Date()): CalendarGateway {
  const store = new Map<string, GEvent>();
  const day = (offset: number, hour: number): string => { const d = new Date(now()); d.setUTCDate(d.getUTCDate() + offset); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };
  const seed = (): GEvent[] => [
    { id: "mock-demo-1", status: "confirmed", summary: "Product demo (sample)", start: { dateTime: day(2, 5) }, end: { dateTime: day(2, 6) }, updated: day(0, 0), extendedProperties: { private: { [PROP.kind]: "demo" } } },
    { id: "mock-hold-1", status: "tentative", summary: "Room hold (sample)", start: { date: day(5, 0).slice(0, 10) }, end: { date: day(7, 0).slice(0, 10) }, updated: day(0, 0), extendedProperties: { private: { [PROP.kind]: "room_hold" } } },
  ];
  seed().forEach((e) => store.set(e.id, e));
  let n = 0;
  return {
    kind: "mock",
    async profile() { return { email: "showcase@calendar.invalid", timeZone: "Asia/Kolkata" }; },
    async listEvents(i) { return { items: [...store.values()], nextSyncToken: i.syncToken ? i.syncToken : "mock-sync-1", timeZone: "Asia/Kolkata" }; },
    async getEvent(_t, id) { return store.get(id) ?? null; },
    async insertEvent(_t, body) { const e = { ...(body as GEvent), id: `mock-new-${++n}`, updated: now().toISOString() }; store.set(e.id, e); return e; },
    async patchEvent(_t, id, body) { const e = { ...(store.get(id) ?? { id }), ...(body as GEvent), id, updated: now().toISOString() }; store.set(id, e); return e; },
  };
}
