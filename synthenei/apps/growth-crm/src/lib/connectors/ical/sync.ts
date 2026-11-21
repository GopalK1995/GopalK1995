// iCal import: fetch each feed of a connection, parse, normalise to stays, and reconcile with the `booking` records of that feed.
// Read-only towards the OTA (we never write back to a feed we import). Idempotent: the same file twice changes nothing.
//   - UID is the identity (external link `ical:<feed id>` + UID), so a re-import never duplicates.
//   - STATUS:CANCELLED cancels; a UID that vanished from the feed cancels too (Airbnb and Booking.com delete instead of marking).
//   - a changed event (new dates, higher SEQUENCE) updates the same record; an older SEQUENCE is ignored.
//   - a feed that suddenly lists nothing while we hold live bookings for it is treated as a broken feed, not as 'everything cancelled'.
//   - consecutive failures are counted per feed; at the threshold the connection goes needs_attention and the owners are told.
import { sha256Hex } from "./hash";
import type { StoredBooking } from "../channel-manager/booking-store";
import { addDays } from "../channel-manager/mapper";
import { dateInZone, validZone } from "../channel-manager/tz";
import type { BookingData, DateOnly } from "../channel-manager/types";
import { FAILURE_THRESHOLD, IMPORT_GRACE_DAYS, SOURCE_LABEL } from "./constants";
import { FeedFetchError } from "./fetch-types";
import { IcalParseError, looksLikeIcs, parseIcs } from "./parser";
import { checkFeedUrl } from "./ssrf";
import { dedupeByUid, eventToStay, type Stay } from "./stays";
import { noticeFor } from "./strings";
import type { FeedRow, FeedScope, IcalDeps } from "./store";

export interface FeedCounts { created: number; updated: number; cancelled: number; unchanged: number; rejected: number; skipped: number }
export class FeedFailure extends Error { constructor(public code: string) { super(code); this.name = "FeedFailure"; } }

const feedObject = (f: FeedRow) => `ical:${f.id}`;
const zoneOf = (f: FeedRow, fallback: string): string => (f.timezone && validZone(f.timezone) ? f.timezone : validZone(fallback) ? fallback : "UTC");

function stayData(f: FeedRow, s: Stay): BookingData {
  return {
    check_in: s.checkIn, check_out: s.checkOut, room: f.propertyKey, guests: null, source_ota: f.source === "other" ? null : f.source, commission_pct: null,
    status: s.cancelled ? "cancelled" : "confirmed", entry: s.kind, ota_channel: f.source, external_ref: null,
    total_amount: null, currency: null, commission_amount: null, guest_name: null, origin: "ical", source_version: s.sequence,
  };
}
const fp = (d: BookingData): string => sha256Hex(JSON.stringify([d.check_in, d.check_out, d.room, d.status, d.entry, d.source_ota]));
const titleOf = (f: FeedRow, s: Stay): string => `${f.label || SOURCE_LABEL[f.source]} ${s.checkIn}`.slice(0, 300);

/** Reads and validates one feed. Throws FeedFailure with a short machine code; nothing about the URL or body leaves this function. */
export async function readFeed(deps: IcalDeps, feed: FeedRow, zone: string): Promise<{ stays: Stay[]; rejected: number; hash: string }> {
  const url = await deps.store.feedUrl(feed);
  if (!url) throw new FeedFailure("no_url");
  const chk = checkFeedUrl(url);
  if (!chk.ok) throw new FeedFailure(`url_${chk.reason}`);
  let res;
  try { res = await deps.fetch(chk.url.toString()); }
  catch (e) { throw new FeedFailure(e instanceof FeedFetchError ? e.code : "connect"); }
  if (res.status !== 200) throw new FeedFailure(`http_${res.status}`);
  if (!looksLikeIcs(res.body)) throw new FeedFailure("not_ical");
  let parsed;
  try { parsed = parseIcs(res.body); } catch (e) { throw new FeedFailure(e instanceof IcalParseError ? e.code : "not_ical"); }
  const stays: Stay[] = [];
  let rejected = parsed.rejected.length;
  for (const ev of parsed.events) { const r = eventToStay(ev, { zone, source: feed.source }); if (r.ok) stays.push(r.stay); else rejected++; }
  return { stays: dedupeByUid(stays), rejected, hash: sha256Hex(res.body) };
}

export async function syncFeed(deps: IcalDeps, feed: FeedRow, objectId: string, defaultZone: string): Promise<FeedCounts & { hash: string; unchangedFeed: boolean }> {
  const zone = zoneOf(feed, defaultZone);
  const scope = { tenantId: feed.tenantId, workspaceId: feed.workspaceId, connectionId: feed.connectionId };
  const today: DateOnly = dateInZone(deps.now().getTime(), zone);
  const cutoff = addDays(today, -IMPORT_GRACE_DAYS);
  const { stays, rejected, hash } = await readFeed(deps, feed, zone);
  const counts: FeedCounts = { created: 0, updated: 0, cancelled: 0, unchanged: 0, rejected, skipped: 0 };

  const existing = await deps.records.listByExternalObject(scope, feedObject(feed));
  const live = existing.filter((e) => e.booking.data.status === "confirmed" && e.booking.data.check_out >= cutoff);
  if (stays.length === 0 && rejected === 0 && live.length >= 3) throw new FeedFailure("empty_feed");   // do not wipe a calendar because a feed hiccuped
  if (hash === feed.lastHash && feed.failures === 0) return { ...counts, hash, unchangedFeed: true };

  const byUid = new Map(existing.map((e) => [e.externalId, e.booking]));
  const emit = (type: "booking.created" | "booking.cancelled", s: { kind: string }, recordId: string) =>
    s.kind === "reservation" ? deps.records.emit({ type, workspaceId: feed.workspaceId, recordId, data: { source: feed.source, origin: "ical" } }) : Promise.resolve();

  for (const s of stays) {
    if (s.checkOut < cutoff) { counts.skipped++; continue; }
    const cur: StoredBooking | undefined = byUid.get(s.uid);
    const data = stayData(feed, s), title = titleOf(feed, s), h = fp(data);
    if (!cur) {
      if (s.cancelled) { counts.skipped++; continue; }
      const id = await deps.records.create(scope, objectId, { title, data }, { externalObject: feedObject(feed), externalId: s.uid, hash: h });
      counts.created++; await emit("booking.created", s, id); continue;
    }
    if (s.sequence < cur.data.source_version) { counts.skipped++; continue; }
    if (cur.hash === h) { counts.unchanged++; continue; }
    const wasCancelled = cur.data.status === "cancelled";
    const r = await deps.records.update(scope, cur, { title, data }, h);
    if (r === "conflict") { counts.skipped++; continue; }          // changed by a person meanwhile; the next poll reconciles
    if (s.cancelled && !wasCancelled) { counts.cancelled++; await emit("booking.cancelled", s, cur.recordId); }
    else { counts.updated++; if (wasCancelled && !s.cancelled) await emit("booking.created", s, cur.recordId); }
  }

  // Vanished UIDs: cancelled upstream. Only upcoming or current stays are touched; history is left as it is.
  const present = new Set(stays.map((x) => x.uid));
  for (const e of live) {
    if (present.has(e.externalId)) continue;
    const next: BookingData = { ...e.booking.data, status: "cancelled" };
    const r = await deps.records.update(scope, e.booking, { title: e.booking.title, data: next }, fp(next));
    if (r === "ok") { counts.cancelled++; await emit("booking.cancelled", { kind: e.booking.data.entry }, e.booking.recordId); } else counts.skipped++;
  }
  return { ...counts, hash, unchangedFeed: false };
}

export interface ImportResult { rowsIn: number; rejected: number; failedFeeds: number; feeds: number; flagged: boolean }

export async function runIcalImport(deps: IcalDeps, scope: FeedScope, defaultZone: string): Promise<ImportResult> {
  const feeds = await deps.store.listFeeds(scope);
  const out: ImportResult = { rowsIn: 0, rejected: 0, failedFeeds: 0, feeds: feeds.length, flagged: false };
  if (!feeds.length) return out;
  const objectId = await deps.records.bookingObjectId(scope);
  if (!objectId) throw new Error("This workspace has no Booking object. Enable the hospitality preset, then retry.");
  for (const feed of feeds) {
    const at = deps.now().toISOString();
    try {
      const c = await syncFeed(deps, feed, objectId, defaultZone);
      await deps.store.recordFeedOk(feed, { hash: c.hash, at });
      out.rowsIn += c.created + c.updated + c.cancelled; out.rejected += c.rejected;
    } catch (e) {
      const code = e instanceof FeedFailure ? e.code : "unexpected";
      if (!(e instanceof FeedFailure)) deps.log.error("ical feed sync failed", { feed: feed.id, connection: scope.connectionId });
      const failures = await deps.store.recordFeedFailure(feed, { code, at });
      out.failedFeeds++; out.rejected++;
      if (failures >= FAILURE_THRESHOLD && !out.flagged) {
        out.flagged = true;
        const n = noticeFor(feed.label || SOURCE_LABEL[feed.source], code);
        await deps.store.flagNeedsAttention(scope, n.message, { dedupe: `ical:${feed.id}:${at.slice(0, 10)}`, title: n.title, body: n.body, url: "/integrations" });
        try { await deps.audit({ action: "ical.feed_failing", summary: `Calendar feed failed ${failures} times in a row (${code})`, detail: { feed: feed.id, source: feed.source, code, failures } }); }
        catch { deps.log.warn("ical audit write failed", { connection: scope.connectionId }); }
      }
    }
  }
  return out;
}
