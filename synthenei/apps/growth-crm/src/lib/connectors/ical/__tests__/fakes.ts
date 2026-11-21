// In-memory IcalStore + a scripted FeedFetcher for the iCal tests.
import { FakeRecords, silent } from "../../channel-manager/__tests__/fake-records";
import { FeedFetchError, type FeedFetcher } from "../fetch-types";
import type { FeedRow, FeedScope, IcalDeps, IcalStore, NewFeed, NewToken, TokenRow, AttentionNotice } from "../store";

export const T = { tenantId: "t-1", workspaceId: "w-1", connectionId: "c-1" } satisfies FeedScope;
export const NOW = new Date("2031-03-01T08:00:00Z");

export class FakeIcalStore implements IcalStore {
  feeds: (FeedRow & { url: string })[] = [];
  tokens: (TokenRow & { hash: string })[] = [];
  flags: { scope: FeedScope; message: string; notice: AttentionNotice }[] = [];
  touched: string[] = [];
  private n = 0;
  async listFeeds(s: FeedScope) { return this.feeds.filter((f) => f.tenantId === s.tenantId && f.workspaceId === s.workspaceId && f.connectionId === s.connectionId).map((f) => ({ ...f })); }
  async countFeeds(s: { tenantId: string; workspaceId: string }) { return this.feeds.filter((f) => f.tenantId === s.tenantId && f.workspaceId === s.workspaceId).length; }
  async feedUrl(f: FeedRow) { return this.feeds.find((x) => x.id === f.id && x.tenantId === f.tenantId)?.url ?? null; }
  async createFeed(f: NewFeed) {
    const row = { id: `feed-${++this.n}`, tenantId: f.tenantId, workspaceId: f.workspaceId, connectionId: f.connectionId, propertyKey: f.propertyKey, source: f.source, label: f.label, timezone: f.timezone, lastHash: null, failures: 0, lastError: null, lastOkAt: null, url: f.url };
    this.feeds.push(row); const { url: _u, ...pub } = row; void _u; return pub;   // like the real store, the URL never comes back
  }
  async deleteFeed(s: FeedScope, id: string) { const i = this.feeds.findIndex((f) => f.id === id && f.tenantId === s.tenantId && f.workspaceId === s.workspaceId); if (i < 0) return false; this.feeds.splice(i, 1); return true; }
  async recordFeedOk(f: FeedRow, r: { hash: string; at: string }) { const x = this.feeds.find((y) => y.id === f.id)!; Object.assign(x, { lastHash: r.hash, failures: 0, lastError: null, lastOkAt: r.at }); }
  async recordFeedFailure(f: FeedRow, r: { code: string }) { const x = this.feeds.find((y) => y.id === f.id)!; x.failures++; x.lastError = r.code; return x.failures; }
  async resetFailures(s: FeedScope) { for (const f of this.feeds) if (f.connectionId === s.connectionId && f.tenantId === s.tenantId) { f.failures = 0; f.lastError = null; } }
  async flagNeedsAttention(scope: FeedScope, message: string, notice: AttentionNotice) { this.flags.push({ scope, message, notice }); }
  async findTokenByHash(hash: string) { const t = this.tokens.find((x) => x.hash === hash); return t ? { ...t } : null; }
  async createToken(t: NewToken) {
    const row = { id: `tok-${++this.n}`, tenantId: t.tenantId, workspaceId: t.workspaceId, propertyKey: t.propertyKey, excludeSource: t.excludeSource, revokedAt: null, lastFetchedAt: null, createdAt: NOW.toISOString(), hash: t.tokenHash };
    this.tokens.push(row); return { ...row };
  }
  async listTokens(s: { tenantId: string; workspaceId: string }) { return this.tokens.filter((t) => t.tenantId === s.tenantId && t.workspaceId === s.workspaceId); }
  async revokeToken(s: { tenantId: string; workspaceId: string }, id: string, at: string) { const t = this.tokens.find((x) => x.id === id && x.tenantId === s.tenantId && x.workspaceId === s.workspaceId && !x.revokedAt); if (!t) return false; t.revokedAt = at; return true; }
  async touchToken(id: string) { this.touched.push(id); }
}

export type Script = Record<string, { status?: number; body?: string; error?: string }>;
/** A fetcher answering from a url -> response table; an `error` is a FeedFetchError code. Records every URL asked for. */
export function scriptedFetch(table: Script): FeedFetcher & { asked: string[]; table: Script } {
  const asked: string[] = [];
  const f = (async (url: string) => {
    asked.push(url);
    const r = table[url];
    if (!r) throw new FeedFetchError("dns");
    if (r.error) throw new FeedFetchError(r.error as never);
    return { status: r.status ?? 200, body: r.body ?? "" };
  }) as FeedFetcher & { asked: string[]; table: Script };
  f.asked = asked; f.table = table;
  return f;
}

export function makeDeps(table: Script = {}, over: Partial<IcalDeps> = {}) {
  const store = new FakeIcalStore();
  const records = new FakeRecords().withObject(T.tenantId).withObject("t-2");
  const fetch = scriptedFetch(table);
  const audits: { action: string; summary: string; detail?: Record<string, unknown> }[] = [];
  const deps: IcalDeps = { store, records, fetch, log: silent, now: () => NOW, audit: async (e) => { audits.push(e); }, ...over };
  return { deps, store, records, fetch, audits };
}

/** An Airbnb-style feed: all-day events, exclusive DTEND, a reservation with PII-ish description and a block. */
export const airbnbFeed = (events: { uid: string; start: string; end: string; summary?: string; seq?: number; status?: string }[]): string =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fixture//EN", "CALSCALE:GREGORIAN",
    ...events.flatMap((e) => ["BEGIN:VEVENT", `UID:${e.uid}`, `DTSTART;VALUE=DATE:${e.start}`, `DTEND;VALUE=DATE:${e.end}`, `SUMMARY:${e.summary ?? "Reserved"}`,
      "DESCRIPTION:Reservation URL: https://example.test/r/SECRET1\\nPhone Number (Last 4 Digits): 4321", ...(e.seq !== undefined ? [`SEQUENCE:${e.seq}`] : []), ...(e.status ? [`STATUS:${e.status}`] : []), "END:VEVENT"]),
    "END:VCALENDAR"].join("\r\n") + "\r\n";
