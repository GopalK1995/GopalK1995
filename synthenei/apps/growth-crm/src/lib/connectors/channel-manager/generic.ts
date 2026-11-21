// The generic channel-manager adapter shell. The partner is not chosen yet (blocker B-6), so this speaks a neutral, documented JSON
// contract instead of any vendor's API; a real partner adapter implements the same `ChannelManager` interface and replaces the three
// mapping functions below. Nothing here names a vendor.
//
//   GET  {base}/v1/account                       -> { id, name }
//   GET  {base}/v1/reservations?cursor=&limit=   -> { items: Item[], next_cursor: string|null, has_more: boolean }
//   PUT  {base}/v1/availability  { window_from, window_to, closed: [{ room, from, to }] }   (the full picture; idempotent)
//   webhook body                                 -> { events: Item[] }       (signature verified by the receiver before it gets here)
//   Item = { event: "created"|"modified"|"cancelled", reservation: { id, channel, channel_ref, check_in, check_out, room, guests,
//            guest_name, total_minor, currency, commission_pct, commission_minor, version } }
import { CredentialError } from "../core/types";
import { CM_CRED, CM_PAGE_SIZE } from "./constants";
import type { AdapterContext, ChannelManager, Reservation, ReservationEvent, ReservationEventKind, ReservationPage } from "./types";

type R = Record<string, unknown>;
const obj = (v: unknown): R | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as R) : undefined);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const KINDS: ReservationEventKind[] = ["created", "modified", "cancelled"];

/** One wire item -> event, or null when it cannot be understood (the caller counts it as rejected; nothing is guessed). */
export function parseItem(raw: unknown): ReservationEvent | null {
  const it = obj(raw), r = obj(it?.reservation);
  const kind = str(it?.event) as ReservationEventKind | null;
  if (!it || !r || !kind || !KINDS.includes(kind)) return null;
  const id = str(r.id), channel = str(r.channel), checkIn = str(r.check_in), checkOut = str(r.check_out), version = numOrNull(r.version);
  if (!id || !channel || !checkIn || !checkOut || version === null) return null;
  const reservation: Reservation = {
    externalId: id, channel, channelRef: str(r.channel_ref), checkIn, checkOut, room: str(r.room), guests: numOrNull(r.guests), guestName: str(r.guest_name),
    totalMinor: numOrNull(r.total_minor), currency: str(r.currency)?.toUpperCase() ?? null, commissionPct: numOrNull(r.commission_pct), commissionMinor: numOrNull(r.commission_minor), version,
  };
  return { kind, reservation };
}

export function parseItems(items: unknown): { events: ReservationEvent[]; rejected: number } {
  const list = Array.isArray(items) ? items : [];
  const events: ReservationEvent[] = [];
  let rejected = 0;
  for (const it of list.slice(0, 500)) { const e = parseItem(it); if (e) events.push(e); else rejected++; }
  return { events, rejected };
}

const headers = (ctx: AdapterContext): Record<string, string> => ({ authorization: `Bearer ${ctx.secrets[CM_CRED.apiKey] ?? ""}`, accept: "application/json" });
const base = (ctx: AdapterContext): string => {
  const b = ctx.apiBase.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^\s/]+/.test(b)) throw new CredentialError("The channel manager endpoint is not configured");
  return b;
};

export const genericChannelManager: ChannelManager = {
  id: "generic",
  async test(ctx) {
    if (!ctx.secrets[CM_CRED.apiKey]) throw new CredentialError("The channel manager key is missing");
    const a = obj(await ctx.http.json<unknown>({ method: "GET", url: `${base(ctx)}/v1/account`, headers: headers(ctx) }));
    return { accountId: str(a?.id) ?? undefined, accountLabel: str(a?.name) ?? undefined };
  },
  async listChanges(ctx, cursor): Promise<ReservationPage> {
    const q = new URLSearchParams({ limit: String(CM_PAGE_SIZE) });
    if (cursor) q.set("cursor", cursor);
    const body = obj(await ctx.http.json<unknown>({ method: "GET", url: `${base(ctx)}/v1/reservations?${q.toString()}`, headers: headers(ctx) }));
    const { events, rejected } = parseItems(body?.items);
    const next = str(body?.next_cursor);
    return { events, rejected, nextCursor: next ?? cursor, done: body?.has_more !== true };
  },
  parseWebhook(rawBody) {
    try { return parseItems(obj(JSON.parse(rawBody))?.events); } catch { return { events: [], rejected: 0 }; }
  },
  async pushAvailability(ctx, s) {
    await ctx.http.json<unknown>({
      method: "PUT", url: `${base(ctx)}/v1/availability`, headers: headers(ctx),
      body: { window_from: s.windowFrom, window_to: s.windowTo, closed: s.closed.map((c) => ({ room: c.room, from: c.from, to: c.to })) },
    });
  },
};
