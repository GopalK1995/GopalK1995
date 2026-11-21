// Calendar pull / push through fakes: incremental sync tokens, 410 restart, tenant scoping, no echo, last write wins, per-user grants,
// and the token lifecycle through the real core (dead grant -> needs_attention).
import { describe, expect, it, vi } from "vitest";
import { refreshIfNeeded } from "../../../core/lifecycle";
import type { RuntimeDeps } from "../../../core/ports";
import type { ConnectionRow, ConnectionSecrets } from "../../../core/types";
import { registerAllConnectors } from "../../../all";
import { createCalendarEvent } from "../actions";
import { SyncTokenGone, type CalendarGateway } from "../gateway";
import { connectGoogleUser, grantFor, grantsOf, refreshAllGrants } from "../grants";
import { calendarPullStep, calendarPushStep } from "../sync";
import type { CalendarDeps, CalendarStore } from "../store";
import type { CalRow, Existing, GEvent, LocalEvent } from "../types";
import { sigOf } from "../mapper";

registerAllConnectors();
const CONN: ConnectionRow = { id: "c-1", tenantId: "t-1", workspaceId: "w-1", connectorId: "google-calendar", mode: "live", status: "connected", settings: {}, credentialSecretId: "sec-1", webhookSecretId: null, tokenExpiresAt: null };
const SECRETS: ConnectionSecrets = { access_token: "a-u1", refresh_token: "r-u1", primary_uid: "u1", "grant:u2": JSON.stringify({ a: "a-u2", r: "r-u2", x: 0 }) };
const NOW = new Date("2026-11-10T00:00:00Z");

function fakeStore(local: LocalEvent[] = [], contacts: Record<string, { type: string; id: string }> = {}) {
  const scopes: unknown[] = [], rows = new Map<string, LocalEvent>(local.map((l) => [l.id, l]));
  const store: CalendarStore = {
    async findByExternal(s, ids) { scopes.push(s); const m = new Map<string, Existing>(); for (const l of rows.values()) if (l.externalId && ids.includes(l.externalId)) m.set(l.externalId, { id: l.id, updatedAt: l.updatedAt, sig: sigOf(l) }); return m; },
    async upsertRemote(s, list, ex) { scopes.push(s); for (const r of list) { const hit = ex.get(r.externalId); const id = hit?.id ?? `L${rows.size + 1}`; rows.set(id, { id, externalId: r.externalId, integrationId: s.connectionId, startsAt: r.startsAt, endsAt: r.endsAt, title: r.title, status: r.status, objectType: r.objectType, objectId: r.objectId, updatedAt: NOW.toISOString() }); } },
    async cancelRemote(s, ext) { scopes.push(s); for (const l of rows.values()) if (l.externalId === ext) { l.status = "cancelled"; return true; } return false; },
    async listPushCandidates(_s, since) { return [...rows.values()].filter((l) => (!l.integrationId && l.status !== "cancelled") || (l.integrationId && since && l.updatedAt > since)); },
    async markLinked(_s, id, ext) { const l = rows.get(id)!; l.integrationId = "c-1"; l.externalId = ext; },
    async insertLinked(_s, r) { const id = `L${rows.size + 1}`; rows.set(id, { id, externalId: r.externalId, integrationId: "c-1", startsAt: r.startsAt, endsAt: r.endsAt, title: r.title, status: r.status, objectType: r.objectType, objectId: r.objectId, updatedAt: NOW.toISOString() }); return id; },
    async contactsByEmail(s, emails) { scopes.push(s); return new Map(emails.filter((e) => contacts[e]).map((e) => [e, contacts[e]])); },
  };
  const deps: CalendarDeps = { store, log: { info() {}, warn() {}, error() {} }, now: () => NOW };
  return { store, deps, rows, scopes };
}
function fakeGateway(pages: Record<string, (i: Parameters<CalendarGateway["listEvents"]>[0]) => ReturnType<CalendarGateway["listEvents"]>>, remote: Record<string, GEvent> = {}) {
  const inserted: Record<string, unknown>[] = [], patched: [string, string][] = [];
  const gw: CalendarGateway = {
    kind: "api", async profile() { return { email: "x@example.com" }; },
    listEvents: (i) => pages[i.token](i),
    async getEvent(_t, id) { return remote[id] ?? null; },
    async insertEvent(t, body) { inserted.push({ token: t, ...body }); return { id: `new-${inserted.length}` }; },
    async patchEvent(t, id) { patched.push([t, id]); return { id }; },
  };
  return { gw, inserted, patched };
}
const stamped = (id: string, summary = "Demo"): GEvent => ({ id, status: "confirmed", summary, updated: "2026-11-09T00:00:00Z", start: { dateTime: "2026-11-12T10:00:00Z" }, end: { dateTime: "2026-11-12T11:00:00Z" }, extendedProperties: { private: { crm_kind: "demo" } } });
const reject = vi.fn();

describe("pull", () => {
  it("reads every live user's calendar, keeps only CRM-related events, scopes every store call to the connection, and stores per-user sync tokens", async () => {
    const f = fakeStore([], { "guest@example.com": { type: "lead", id: "lead-1" } });
    const g = fakeGateway({
      "a-u1": async (i) => { expect(i.syncToken).toBeUndefined(); expect(i.timeMin).toBeTruthy(); return { items: [stamped("e1"), { id: "e2", summary: "Dentist", start: { dateTime: "2026-11-12T10:00:00Z" }, end: { dateTime: "2026-11-12T11:00:00Z" } }], nextSyncToken: "s-u1" }; },
      "a-u2": async () => ({ items: [{ id: "e3", summary: "Intro", start: { dateTime: "2026-11-13T10:00:00Z" }, end: { dateTime: "2026-11-13T11:00:00Z" }, attendees: [{ email: "guest@example.com" }] }], nextSyncToken: "s-u2" }),
    });
    const r = await calendarPullStep({ deps: f.deps, conn: CONN, secrets: SECRETS, gateway: g.gw, reject }, undefined);
    expect(r).toMatchObject({ done: true, rowsIn: 2, rowsRejected: 0, cursor: { g: { u1: { syncToken: "s-u1" }, u2: { syncToken: "s-u2" } } }, sample: { kept: 2, ignored: 1 } });
    expect([...f.rows.values()].map((l) => l.externalId).sort()).toEqual(["u1:e1", "u2:e3"]);
    expect(f.scopes.every((s) => JSON.stringify(s) === JSON.stringify({ tenantId: "t-1", workspaceId: "w-1", connectionId: "c-1" }))).toBe(true);
    // a second run uses the token and a cancellation reaches the stored row
    const g2 = fakeGateway({ "a-u1": async (i) => { expect(i.syncToken).toBe("s-u1"); return { items: [{ id: "e1", status: "cancelled" }], nextSyncToken: "s-u1b" }; }, "a-u2": async () => ({ items: [], nextSyncToken: "s-u2b" }) });
    const r2 = await calendarPullStep({ deps: f.deps, conn: CONN, secrets: SECRETS, gateway: g2.gw, reject }, r.cursor);
    expect(r2.cursor).toMatchObject({ g: { u1: { syncToken: "s-u1b" } } });
    expect([...f.rows.values()].find((l) => l.externalId === "u1:e1")!.status).toBe("cancelled");
  });
  it("pages, and restarts a user's window after HTTP 410", async () => {
    const f = fakeStore();
    let n = 0;
    const g = fakeGateway({ "a-u1": async (i) => { n++; if (i.syncToken) throw new SyncTokenGone(); return n === 1 ? { items: [stamped("p1")], nextPageToken: "pg2" } : { items: [stamped("p2")], nextSyncToken: "s" }; }, "a-u2": async () => ({ items: [], nextSyncToken: "t" }) });
    const one = { ...SECRETS }; delete one["grant:u2"];
    const a = await calendarPullStep({ deps: f.deps, conn: CONN, secrets: one, gateway: g.gw, reject }, undefined);
    expect(a).toMatchObject({ done: false, cursor: { g: { u1: { pageToken: "pg2" } } } });
    const b = await calendarPullStep({ deps: f.deps, conn: CONN, secrets: one, gateway: g.gw, reject }, a.cursor);
    expect(b).toMatchObject({ done: true, cursor: { g: { u1: { syncToken: "s" } } } });
    const c = await calendarPullStep({ deps: f.deps, conn: CONN, secrets: one, gateway: g.gw, reject }, b.cursor);
    expect(c).toMatchObject({ done: false, cursor: { g: { u1: {} } }, sample: { resync: 1 } });
  });
  it("keeps a local edit that is newer than Google's copy", async () => {
    const local: LocalEvent = { id: "L1", externalId: "u1:e1", integrationId: "c-1", startsAt: "2026-11-12T10:00:00.000Z", endsAt: "2026-11-12T11:00:00.000Z", title: "Edited here", status: "confirmed", objectType: null, objectId: null, updatedAt: "2026-11-09T12:00:00.000Z" };
    const f = fakeStore([local]);
    const one = { ...SECRETS }; delete one["grant:u2"];
    const g = fakeGateway({ "a-u1": async () => ({ items: [stamped("e1", "Old title")], nextSyncToken: "s" }) });
    const r = await calendarPullStep({ deps: f.deps, conn: CONN, secrets: one, gateway: g.gw, reject }, undefined);
    expect(r.sample).toMatchObject({ conflicts_kept_local: 1, kept: 0 });
    expect(f.rows.get("L1")!.title).toBe("Edited here");
  });
  it("does nothing without a live grant", async () => {
    const r = await calendarPullStep({ deps: fakeStore().deps, conn: CONN, secrets: {}, gateway: fakeGateway({}).gw, reject }, undefined);
    expect(r).toMatchObject({ done: true, sample: { skipped: "no_live_grant" } });
  });
});

describe("push", () => {
  const unlinked: LocalEvent = { id: "L1", externalId: null, integrationId: null, startsAt: "2026-12-01T00:00:00.000Z", endsAt: "2026-12-02T00:00:00.000Z", title: "Hold", status: "tentative", objectType: "obj:booking", objectId: "rec-1", updatedAt: "2026-11-09T00:00:00.000Z" };
  it("creates CRM-side rows in the primary calendar and links them", async () => {
    const f = fakeStore([{ ...unlinked }]), g = fakeGateway({});
    const r = await calendarPushStep({ deps: f.deps, conn: CONN, secrets: SECRETS, gateway: g.gw, reject }, undefined);
    expect(g.inserted).toHaveLength(1);
    expect(g.inserted[0]).toMatchObject({ token: "a-u1", status: "tentative", extendedProperties: { private: { crm_kind: "room_hold", crm_object_id: "rec-1" } } });
    expect(f.rows.get("L1")).toMatchObject({ integrationId: "c-1", externalId: "u1:new-1" });
    expect(r).toMatchObject({ done: true, sample: { created: 1 } });
  });
  it("patches a changed linked row, skips an echo of equal content and a newer Google copy", async () => {
    const mk = (id: string, ext: string, title: string): LocalEvent => ({ ...unlinked, id, integrationId: "c-1", externalId: ext, title, status: "confirmed", updatedAt: "2026-11-09T12:00:00.000Z" });
    const f = fakeStore([mk("A", "u1:ga", "Changed here"), mk("B", "u2:gb", "Same"), mk("C", "u1:gc", "Local old")]);
    const remote = (id: string, summary: string, updated: string): GEvent => ({ ...stamped(id, summary), updated, start: { dateTime: unlinked.startsAt }, end: { dateTime: unlinked.endsAt } });
    const g = fakeGateway({}, { ga: remote("ga", "Was", "2026-11-01T00:00:00Z"), gb: remote("gb", "Same", "2026-11-09T12:00:00Z"), gc: remote("gc", "Newer in Google", "2026-11-10T00:00:00Z") });
    const r = await calendarPushStep({ deps: f.deps, conn: CONN, secrets: SECRETS, gateway: g.gw, reject }, { since: "2026-11-09T00:00:00.000Z" });
    expect(g.patched).toEqual([["a-u1", "ga"]]);
    expect(r.sample).toMatchObject({ patched: 1, unchanged: 1, skipped: 1 });
    expect(r.cursor).toEqual({ since: NOW.toISOString() });
  });
  it("continues a backlog on the next page instead of dropping it", async () => {
    const many = Array.from({ length: 3 }, (_, i): LocalEvent => ({ ...unlinked, integrationId: null, externalId: null, id: `L${i + 1}`, updatedAt: `2026-11-09T00:00:0${i}.000Z` }));
    const f = fakeStore(many), g = fakeGateway({});
    const r = await calendarPushStep({ deps: f.deps, conn: CONN, secrets: SECRETS, gateway: g.gw, reject }, undefined, 2);
    expect(r.done).toBe(false);
    expect(g.inserted).toHaveLength(2);
  });
});

describe("createCalendarEvent (server-action target)", () => {
  const vault = new Map([["sec-1", JSON.stringify(SECRETS)]]);
  const d = (conn: ConnectionRow | null): RuntimeDeps => ({ store: { getConnection: async () => conn } as never, vault: { getSecret: async (id: string) => vault.get(id) ?? null } as never, env: {}, log: { info() {}, warn() {}, error() {} }, audit: vi.fn(async () => undefined) });
  it("creates the event (Showcase gateway, no network), links the row and audits ids only", async () => {
    const f = fakeStore();
    vault.set("sec-1", JSON.stringify({ access_token: "google-mock-token" }));
    const rt = d(CONN);
    const r = await createCalendarEvent(rt, f.deps, { uid: "u2", tenantId: "t-1", workspaceId: "w-1" }, "c-1", { title: "Site visit", startsAt: "2026-12-01T05:00:00Z", endsAt: "2026-12-01T06:00:00Z", kind: "meeting", objectType: "lead", objectId: "lead-1" });
    vault.set("sec-1", JSON.stringify(SECRETS));
    expect(r.ok).toBe(true);
    expect([...f.rows.values()][0]).toMatchObject({ externalId: "showcase:mock-new-1", integrationId: "c-1", objectId: "lead-1" });
    expect(rt.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "gcal.event_created", detail: { kind: "meeting", local: expect.any(String) } }));
  });
  it("picks the acting user's own grant, else the primary", () => {
    expect(grantFor(SECRETS, "u2")!.access).toBe("a-u2");
    expect(grantFor(SECRETS, "someone-else")!.access).toBe("a-u1");
  });
  it("treats another tenant's or workspace's connection as missing and rejects bad input", async () => {
    const f = fakeStore();
    const base = { title: "x", startsAt: "2026-12-01T05:00:00Z", endsAt: "2026-12-01T06:00:00Z", kind: "meeting" as const };
    expect(await createCalendarEvent(d(CONN), f.deps, { uid: "u1", tenantId: "t-2", workspaceId: "w-1" }, "c-1", base)).toEqual({ ok: false, code: "not_found" });
    expect(await createCalendarEvent(d(CONN), f.deps, { uid: "u1", tenantId: "t-1", workspaceId: "w-9" }, "c-1", base)).toEqual({ ok: false, code: "not_found" });
    expect(await createCalendarEvent(d(CONN), f.deps, { uid: "u1", tenantId: "t-1", workspaceId: "w-1" }, "c-1", { ...base, endsAt: "2026-12-01T04:00:00Z" })).toEqual({ ok: false, code: "invalid_input" });
    expect(f.rows.size).toBe(0);
  });
});

describe("per-user grants and token expiry", () => {
  const env = { GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OAUTH_CLIENT_SECRET: "secret" };
  const resp = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  it("lists grants without tokens and refreshes each user's own token", async () => {
    expect(grantsOf(SECRETS).map((g) => [g.uid, g.primary])).toEqual([["u1", true], ["u2", false]]);
    const seen: string[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => { const r = new URLSearchParams(String(init.body)).get("refresh_token")!; seen.push(r); return resp(200, { access_token: `new-${r}`, expires_in: 3600 }); }) as unknown as typeof fetch;
    const out = await refreshAllGrants({ secrets: SECRETS, env, fetchImpl, nowMs: 1_000_000 });
    expect(seen).toEqual(["r-u1", "r-u2"]);
    expect(out.secrets.access_token).toBe("new-r-u1");
    expect(JSON.parse(out.secrets["grant:u2"])).toMatchObject({ a: "new-r-u2", r: "r-u2" });
  });
  it("marks another user's revoked grant dead without failing the connection", async () => {
    const fetchImpl = (async (_u: string, init: RequestInit) => new URLSearchParams(String(init.body)).get("refresh_token") === "r-u2" ? resp(400, { error: "invalid_grant" }) : resp(200, { access_token: "n", expires_in: 3600 })) as unknown as typeof fetch;
    const out = await refreshAllGrants({ secrets: SECRETS, env, fetchImpl });
    expect(grantsOf(out.secrets).find((g) => g.uid === "u2")!.dead).toBe(true);
  });
  it("a revoked primary grant flips the connection to needs_attention through the real core", async () => {
    const patches: Record<string, unknown>[] = [];
    const vault = new Map([["sec-1", JSON.stringify(SECRETS)]]);
    const d: RuntimeDeps = {
      store: { updateConnection: async (_id: string, p: Record<string, unknown>) => { patches.push(p); } } as never,
      vault: { getSecret: async (id: string) => vault.get(id) ?? null, putSecret: async () => "sec-2", deleteSecret: async () => undefined },
      env, log: { info() {}, warn() {}, error() {} }, now: () => NOW,
      fetchImpl: (async () => resp(400, { error: "invalid_grant" })) as unknown as typeof fetch,
    };
    const r = await refreshIfNeeded(d, { ...CONN, tokenExpiresAt: "2026-11-09T00:00:00Z" });
    expect(r).toEqual({ ok: false, reason: "needs_attention" });
    expect(patches[0]).toMatchObject({ status: "needs_attention" });
  });
  it("adds a second user as an extra grant on a live connection and audits it", async () => {
    const saved: ConnectionSecrets[] = [];
    const vault = new Map([["sec-1", JSON.stringify({ access_token: "a1", refresh_token: "r1", primary_uid: "u1" })]]);
    const d: RuntimeDeps = {
      store: { findConnection: async () => CONN, updateConnection: async () => undefined } as never,
      vault: { getSecret: async (id: string) => vault.get(id) ?? null, putSecret: async (_n: string, v: string) => { saved.push(JSON.parse(v)); return "sec-2"; }, deleteSecret: async () => undefined },
      env: {}, log: { info() {}, warn() {}, error() {} }, audit: vi.fn(async () => undefined),
    };
    const r = await connectGoogleUser(d, { uid: "u3", tenantId: "t-1", workspaceId: "w-1" }, "google-calendar", { secrets: { access_token: "a3", refresh_token: "r3" }, expiresInSec: 3600 }, { email: "u3@example.com" });
    expect(r.ok).toBe(true);
    expect(saved[0].access_token).toBe("a1");
    expect(JSON.parse(saved[0]["grant:u3"])).toMatchObject({ a: "a3", r: "r3", e: "u3@example.com" });
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "google.user_connected" }));
    expect(await connectGoogleUser(d, { uid: "u3", tenantId: "t-OTHER", workspaceId: "w-1" }, "google-calendar", { secrets: { access_token: "a3", refresh_token: "r3" } })).toEqual({ ok: false, code: "not_found" });
  });
});

export type { CalRow };
