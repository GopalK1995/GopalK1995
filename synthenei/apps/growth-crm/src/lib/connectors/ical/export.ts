// iCal export: blocked dates of one property as a feed that Airbnb, Booking.com or any calendar app can subscribe to.
// Access is a bearer token in the URL: 256 random bits, only its SHA-256 is stored, one token per property (and optionally per channel so a
// channel never gets its own bookings back). A bad, unknown or revoked token answers one identical 404, so nothing can be probed.
// The feed carries dates only: "Not available", no guest, no amount, no booking id that means anything outside this system.
import { createHash, randomBytes } from "node:crypto";
import type { StoredBooking } from "../channel-manager/booking-store";
import { isDateOnly } from "../channel-manager/mapper";
import { dateInZone } from "../channel-manager/tz";
import { EXPORT_MAX_EVENTS, EXPORT_PRODID, EXPORT_SUMMARY, EXPORT_UID_DOMAIN, TOKEN_BYTES, TOKEN_PATTERN, type FeedSource } from "./constants";
import type { IcalDeps } from "./store";

export const newToken = (): string => randomBytes(TOKEN_BYTES).toString("base64url");
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** RFC 5545 TEXT escaping. */
const esc = (s: string): string => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Folds a content line at 75 octets (never inside a multi-byte character), CRLF, continuation lines start with one space. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "", size = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > limit) { out.push(cur); cur = ""; size = 0; limit = 74; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateVal = (d: string): string => d.replace(/-/g, "");

export interface IcsEvent { uid: string; checkIn: string; checkOut: string; sequence: number }

export function buildIcs(events: IcsEvent[], o: { calName: string; now: Date }): string {
  const L: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${EXPORT_PRODID}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(o.calName)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT30M", "X-PUBLISHED-TTL:PT30M"];
  for (const e of events) {
    L.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp(o.now)}`, `DTSTART;VALUE=DATE:${dateVal(e.checkIn)}`, `DTEND;VALUE=DATE:${dateVal(e.checkOut)}`,
      `SUMMARY:${esc(EXPORT_SUMMARY)}`, "STATUS:CONFIRMED", "TRANSP:OPAQUE", `SEQUENCE:${e.sequence}`, "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(foldLine).join("\r\n") + "\r\n";
}

/** Merges touching or overlapping ranges so a channel sees one block per run of nights, not one per booking. */
export function mergeRanges<T extends { checkIn: string; checkOut: string }>(rows: T[]): { checkIn: string; checkOut: string }[] {
  const sorted = [...rows].sort((a, b) => (a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : 0));
  const out: { checkIn: string; checkOut: string }[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.checkIn <= last.checkOut) { if (r.checkOut > last.checkOut) last.checkOut = r.checkOut; } else out.push({ checkIn: r.checkIn, checkOut: r.checkOut });
  }
  return out;
}

const fromChannel = (b: StoredBooking, exclude: FeedSource): boolean => b.data.ota_channel === exclude || b.data.source_ota === exclude;

export interface FeedHttpResponse { status: 200 | 404; headers: Record<string, string>; body: string }
const NOT_FOUND: FeedHttpResponse = { status: 404, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" }, body: "Not found\n" };

/** The whole request handler, minus HTTP plumbing: the route (`/api/ical/<token>.ics`, integrator) passes the path segment and relays the result.
 *  The route must also apply the platform rate limit per IP before calling this. */
export async function handleFeedRequest(deps: IcalDeps, rawToken: string): Promise<FeedHttpResponse> {
  const token = (rawToken ?? "").replace(/\.ics$/i, "");
  if (!TOKEN_PATTERN.test(token)) return NOT_FOUND;
  const row = await deps.store.findTokenByHash(hashToken(token));
  if (!row || row.revokedAt) return NOT_FOUND;
  const now = deps.now();
  const from = dateInZone(now.getTime() - 86_400_000, "UTC");   // yesterday in UTC: a stay ending today is still shown until it is over everywhere
  const all = await deps.records.listBlocking({ tenantId: row.tenantId, workspaceId: row.workspaceId }, { fromDate: from, room: row.propertyKey, limit: EXPORT_MAX_EVENTS });
  const keep = all.filter((b) => b.data.status === "confirmed" && isDateOnly(b.data.check_in) && isDateOnly(b.data.check_out) && b.data.check_out > b.data.check_in && !(row.excludeSource && fromChannel(b, row.excludeSource)));
  const events = mergeRanges(keep.map((b) => ({ checkIn: b.data.check_in, checkOut: b.data.check_out }))).slice(0, EXPORT_MAX_EVENTS)
    .map((r) => ({ uid: `${hashToken(`${row.id}:${r.checkIn}`).slice(0, 32)}@${EXPORT_UID_DOMAIN}`, checkIn: r.checkIn, checkOut: r.checkOut, sequence: 0 }));
  const body = buildIcs(events, { calName: "Availability", now });
  void deps.store.touchToken(row.id, now.toISOString()).catch(() => undefined);   // best effort
  return { status: 200, headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=300", "x-robots-tag": "noindex", "content-disposition": 'inline; filename="availability.ics"' }, body };
}
