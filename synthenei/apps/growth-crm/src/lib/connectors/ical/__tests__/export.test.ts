import { describe, expect, it } from "vitest";
import { buildIcs, foldLine, handleFeedRequest, hashToken, mergeRanges, newToken } from "../export";
import { parseIcs } from "../parser";
import { addFeed, createExportToken, removeFeed, revokeExportToken } from "../manage";
import { airbnbFeed, makeDeps, NOW, T } from "./fakes";

const actor = { uid: "u-1", tenantId: T.tenantId, workspaceId: T.workspaceId };

describe("ICS builder", () => {
  it("writes RFC 5545 with CRLF, DATE values and no guest data", () => {
    const ics = buildIcs([{ uid: "a@x.invalid", checkIn: "2031-03-10", checkOut: "2031-03-13", sequence: 0 }], { calName: "Availability", now: NOW });
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.split("\r\n").filter(Boolean)[0]).toBe("BEGIN:VCALENDAR");
    expect(ics).toContain("DTSTART;VALUE=DATE:20310310\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20310313\r\n");
    expect(ics).toContain("DTSTAMP:20310301T080000Z\r\n");
    expect(ics).toContain("SUMMARY:Not available\r\n");
    expect(ics).not.toMatch(/ATTENDEE|DESCRIPTION|LOCATION/);
  });
  it("round-trips through our own parser", () => {
    const ics = buildIcs([{ uid: "a@x.invalid", checkIn: "2031-03-10", checkOut: "2031-03-13", sequence: 0 }, { uid: "b@x.invalid", checkIn: "2031-04-01", checkOut: "2031-04-02", sequence: 0 }], { calName: "Availability", now: NOW });
    const p = parseIcs(ics);
    expect(p.events.map((e) => [e.dtstart, e.dtend])).toEqual([[{ kind: "date", date: "2031-03-10" }, { kind: "date", date: "2031-03-13" }], [{ kind: "date", date: "2031-04-01" }, { kind: "date", date: "2031-04-02" }]]);
  });
  it("folds long lines at 75 octets without splitting a multi-byte character", () => {
    const line = "X-LONG:" + "é".repeat(80);
    const folded = foldLine(line);
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n").map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(line);
  });
  it("merges touching and overlapping ranges", () => {
    expect(mergeRanges([{ checkIn: "2031-03-12", checkOut: "2031-03-14" }, { checkIn: "2031-03-10", checkOut: "2031-03-12" }, { checkIn: "2031-03-20", checkOut: "2031-03-22" }, { checkIn: "2031-03-21", checkOut: "2031-03-25" }]))
      .toEqual([{ checkIn: "2031-03-10", checkOut: "2031-03-14" }, { checkIn: "2031-03-20", checkOut: "2031-03-25" }]);
  });
});

describe("the per-property feed", () => {
  async function seed() {
    const ctx = makeDeps();
    const mk = await createExportToken(ctx.deps, actor, { propertyKey: "room-a" });
    if (!mk.ok) throw new Error("token");
    ctx.records.addManual("t-1", "w-1", { room: "room-a", check_in: "2031-03-10", check_out: "2031-03-13", guest_name: "Jane Doe", total_amount: 99999 });
    ctx.records.addManual("t-1", "w-1", { room: "room-a", check_in: "2031-03-13", check_out: "2031-03-15", source_ota: "airbnb", ota_channel: "airbnb" });
    ctx.records.addManual("t-1", "w-1", { room: "room-b", check_in: "2031-03-10", check_out: "2031-03-12" });
    ctx.records.addManual("t-1", "w-1", { room: "room-a", check_in: "2031-03-20", check_out: "2031-03-22", status: "cancelled" });
    ctx.records.addManual("t-2", "w-2", { room: "room-a", check_in: "2031-03-25", check_out: "2031-03-27" });
    return { ...ctx, token: mk.value.token, row: mk.value.row, path: mk.value.path };
  }
  it("serves only this property's confirmed dates, merged, with no guest or money data", async () => {
    const { deps, token } = await seed();
    const res = await handleFeedRequest(deps, `${token}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/calendar; charset=utf-8");
    expect(res.headers["x-robots-tag"]).toBe("noindex");
    const ev = parseIcs(res.body).events;
    expect(ev).toHaveLength(1);
    expect(ev[0].dtstart).toEqual({ kind: "date", date: "2031-03-10" });
    expect(ev[0].dtend).toEqual({ kind: "date", date: "2031-03-15" });
    expect(res.body).not.toMatch(/Jane|99999|room-b|2031-03-2/);   // not the guest, not the amount, not another room, not a cancelled or another tenant's booking
  });
  it("works without the .ics suffix and records the fetch", async () => {
    const { deps, token, store, row } = await seed();
    expect((await handleFeedRequest(deps, token)).status).toBe(200);
    expect(store.touched).toContain(row.id);
  });
  it("can leave a channel's own bookings out so it never receives them back", async () => {
    const ctx = await seed();
    const mk = await createExportToken(ctx.deps, actor, { propertyKey: "room-a", excludeSource: "airbnb" });
    if (!mk.ok) throw new Error("token");
    const ev = parseIcs((await handleFeedRequest(ctx.deps, mk.value.token)).body).events;
    expect(ev).toHaveLength(1);
    expect(ev[0].dtend).toEqual({ kind: "date", date: "2031-03-13" });
  });
  it("answers one identical 404 for an unknown, malformed, revoked or other-tenant token", async () => {
    const { deps, token, row } = await seed();
    const unknown = await handleFeedRequest(deps, newToken());
    const malformed = await handleFeedRequest(deps, "short");
    const sqlish = await handleFeedRequest(deps, "' or 1=1 --");
    expect(await revokeExportToken(deps, actor, row.id)).toMatchObject({ ok: true });
    const revoked = await handleFeedRequest(deps, token);
    for (const r of [unknown, malformed, sqlish, revoked]) expect(r).toEqual(unknown);
    expect(unknown.status).toBe(404);
    expect(unknown.body).not.toContain("BEGIN:VCALENDAR");
    expect(await revokeExportToken(deps, { ...actor, tenantId: "t-2" }, row.id)).toEqual({ ok: false, code: "not_found" });
  });
  it("stores only the hash of the token and shows the plaintext once", async () => {
    const { store, token, path, row } = await seed();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(path).toBe(`/api/ical/${token}.ics`);
    expect(JSON.stringify(store.tokens)).not.toContain(token);
    expect(store.tokens.find((t) => t.id === row.id)!.hash).toBe(hashToken(token));
    expect(new Set(Array.from({ length: 50 }, () => newToken())).size).toBe(50);
  });
  it("does not create a token when the audit row cannot be written", async () => {
    const ctx = makeDeps({}, { audit: async () => { throw new Error("down"); } });
    expect(await createExportToken(ctx.deps, actor, { propertyKey: "room-a" })).toEqual({ ok: false, code: "audit_failed" });
    expect(ctx.store.tokens).toHaveLength(0);
  });
  it("never audits the token itself", async () => {
    const { audits, token } = await seed();
    expect(JSON.stringify(audits)).not.toContain(token);
    expect(audits[0].action).toBe("ical.token_created");
  });
});

describe("managing feeds", () => {
  const URL_OK = "https://cal.example.test/a/room.ics?s=PRIVATE";
  const scope = T;
  const input = (over: object = {}) => ({ scope, propertyKey: "room-a", source: "airbnb", label: "Room A", url: URL_OK, ...over });
  const good = { [URL_OK]: { body: airbnbFeed([{ uid: "u", start: "20310310", end: "20310312" }]) } };

  it("adds a feed after proving the link works, stores the URL only through the store, audits host not URL", async () => {
    const { deps, store, audits } = makeDeps(good);
    const r = await addFeed(deps, actor, input());
    expect(r.ok).toBe(true);
    expect(store.feeds).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "ical.feed_added", detail: { host: "cal.example.test", property: "room-a" } });
    expect(JSON.stringify(audits)).not.toContain("PRIVATE");
    if (r.ok) expect(JSON.stringify(r.value)).not.toContain("PRIVATE");
  });
  it.each([
    ["an http link", { url: "http://cal.example.test/a.ics" }, "url_not_https"],
    ["a private host", { url: "https://10.0.0.5/a.ics" }, "url_ip_literal"],
    ["a link-local metadata name", { url: "https://metadata.internal/a.ics" }, "url_blocked_host"],
    ["an empty property", { propertyKey: "  " }, "invalid_property"],
    ["an unknown source", { source: "vrbo" }, "invalid_source"],
    ["a bad time zone", { timezone: "Mars/Olympus" }, "invalid_timezone"],
  ])("refuses %s", async (_n, over, code) => {
    const { deps, store } = makeDeps(good);
    expect(await addFeed(deps, actor, input(over))).toEqual({ ok: false, code });
    expect(store.feeds).toHaveLength(0);
  });
  it("refuses a link that does not return a calendar or cannot be reached", async () => {
    const a = makeDeps({ [URL_OK]: { body: "<html>login</html>" } });
    expect(await addFeed(a.deps, actor, input())).toEqual({ ok: false, code: "not_ical" });
    const b = makeDeps({ [URL_OK]: { status: 403 } });
    expect(await addFeed(b.deps, actor, input())).toEqual({ ok: false, code: "unreachable" });
    const c = makeDeps({ [URL_OK]: { error: "blocked_address" } });
    expect(await addFeed(c.deps, actor, input())).toEqual({ ok: false, code: "url_blocked_host" });
  });
  it("is blocked for another tenant's scope, enforces the per-workspace limit, and aborts when audit fails", async () => {
    const x = makeDeps(good);
    expect(await addFeed(x.deps, { ...actor, tenantId: "t-2" }, input())).toEqual({ ok: false, code: "not_found" });
    for (let i = 0; i < 20; i++) await x.store.createFeed({ ...T, propertyKey: `r${i}`, source: "other", label: "", timezone: null, url: URL_OK });
    expect(await addFeed(x.deps, actor, input())).toEqual({ ok: false, code: "limit_reached" });
    const y = makeDeps(good, { audit: async () => { throw new Error("down"); } });
    expect(await addFeed(y.deps, actor, input())).toEqual({ ok: false, code: "audit_failed" });
    expect(y.store.feeds).toHaveLength(0);
  });
  it("removes a feed only inside its own workspace and keeps the imported bookings", async () => {
    const { deps, store, records } = makeDeps(good);
    const r = await addFeed(deps, actor, input());
    if (!r.ok) throw new Error("add");
    records.addManual("t-1", "w-1", { check_in: "2031-03-10", check_out: "2031-03-12" });
    expect(await removeFeed(deps, { ...actor, workspaceId: "w-2" }, T, r.value.id)).toEqual({ ok: false, code: "not_found" });
    expect(await removeFeed(deps, actor, T, r.value.id)).toEqual({ ok: true, value: { id: r.value.id } });
    expect(store.feeds).toHaveLength(0);
    expect(records.records).toHaveLength(1);
  });
});
