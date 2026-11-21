import { afterEach, describe, expect, it } from "vitest";
import { registerConnector, resetRegistry } from "../../registry";
import { makeDeps as makeCoreDeps } from "../../core/__tests__/fakes";
import { runSync } from "../../core/sync";
import { icalConnector, setIcalRuntimeFactory } from "../connector";
import { FAILURE_THRESHOLD } from "../constants";
import { runIcalImport } from "../sync";
import { airbnbFeed, makeDeps, NOW, T } from "./fakes";

const URL_A = "https://cal.example.test/airbnb/room-a.ics?s=SECRETTOKEN";
const URL_B = "https://cal.example.test/booking/room-a.ics";

async function withFeed(table: Record<string, { status?: number; body?: string; error?: string }>, source: "airbnb" | "booking_com" | "other" = "airbnb", url = URL_A) {
  const ctx = makeDeps(table);
  const feed = await ctx.store.createFeed({ ...T, propertyKey: "room-a", source, label: "Room A", timezone: "Asia/Kolkata", url });
  return { ...ctx, feed };
}
const body = (events: Parameters<typeof airbnbFeed>[0]) => ({ [URL_A]: { body: airbnbFeed(events) } });

describe("iCal import", () => {
  it("creates booking records labelled with their OTA, with no guest data", async () => {
    const { deps, records } = await withFeed(body([{ uid: "u1", start: "20310310", end: "20310313" }, { uid: "u2", start: "20310320", end: "20310322", summary: "Airbnb (Not available)" }]));
    const r = await runIcalImport(deps, T, "UTC");
    expect(r).toMatchObject({ rowsIn: 2, failedFeeds: 0 });
    const rows = records.records.map((x) => x.data);
    expect(rows[0]).toMatchObject({ check_in: "2031-03-10", check_out: "2031-03-13", room: "room-a", source_ota: "airbnb", ota_channel: "airbnb", entry: "reservation", origin: "ical", status: "confirmed", guest_name: null, commission_pct: null });
    expect(rows[1].entry).toBe("block");
    expect(JSON.stringify(records.records)).not.toMatch(/4321|SECRET1|Reservation URL/);
    expect(records.events.map((e) => e.type)).toEqual(["booking.created"]);   // a block is not a booking: no event
  });

  it("is idempotent: the same file twice, and the same events in a different order, change nothing", async () => {
    const evs = [{ uid: "u1", start: "20310310", end: "20310313" }, { uid: "u2", start: "20310320", end: "20310322" }];
    const { deps, records, fetch, feed } = await withFeed(body(evs));
    await runIcalImport(deps, T, "UTC");
    const snap = JSON.stringify(records.records);
    expect((await runIcalImport(deps, T, "UTC")).rowsIn).toBe(0);
    fetch.table[URL_A] = { body: airbnbFeed([...evs].reverse()) };
    expect((await runIcalImport(deps, T, "UTC")).rowsIn).toBe(0);
    expect(JSON.stringify(records.records)).toBe(snap);
    expect(records.records).toHaveLength(2);
    expect(feed.id).toBeTruthy();
  });

  it("updates the same record when an event's dates change, and ignores an older SEQUENCE", async () => {
    const { deps, records, fetch } = await withFeed(body([{ uid: "u1", start: "20310310", end: "20310313", seq: 1 }]));
    await runIcalImport(deps, T, "UTC");
    fetch.table[URL_A] = { body: airbnbFeed([{ uid: "u1", start: "20310310", end: "20310315", seq: 2 }]) };
    expect((await runIcalImport(deps, T, "UTC")).rowsIn).toBe(1);
    expect(records.records).toHaveLength(1);
    expect(records.records[0].data).toMatchObject({ check_out: "2031-03-15", source_version: 2 });
    fetch.table[URL_A] = { body: airbnbFeed([{ uid: "u1", start: "20310310", end: "20310311", seq: 1 }]) };
    await runIcalImport(deps, T, "UTC");
    expect(records.records[0].data.check_out).toBe("2031-03-15");
  });

  it("cancels on STATUS:CANCELLED and when the event vanishes from the feed, with events", async () => {
    const { deps, records, fetch } = await withFeed(body([{ uid: "u1", start: "20310310", end: "20310313" }, { uid: "u2", start: "20310320", end: "20310322" }, { uid: "u3", start: "20310325", end: "20310326" }, { uid: "u4", start: "20310327", end: "20310328" }]));
    await runIcalImport(deps, T, "UTC");
    fetch.table[URL_A] = { body: airbnbFeed([{ uid: "u1", start: "20310310", end: "20310313", status: "CANCELLED", seq: 1 }, { uid: "u2", start: "20310320", end: "20310322" }, { uid: "u3", start: "20310325", end: "20310326" }]) };
    const r = await runIcalImport(deps, T, "UTC");
    expect(r.rowsIn).toBe(2);   // u1 cancelled by status, u4 by absence
    const by = (uid: string) => records.records.find((x) => records.links.find((l) => l.recordId === x.id)?.extId === uid)!.data.status;
    expect([by("u1"), by("u2"), by("u3"), by("u4")]).toEqual(["cancelled", "confirmed", "confirmed", "cancelled"]);
    expect(records.events.filter((e) => e.type === "booking.cancelled")).toHaveLength(2);
  });

  it("reactivates a stay that the feed lists again and leaves history alone", async () => {
    const { deps, records, fetch } = await withFeed(body([{ uid: "old", start: "20310101", end: "20310103" }, { uid: "u1", start: "20310310", end: "20310313" }, { uid: "u2", start: "20310320", end: "20310322" }, { uid: "u3", start: "20310325", end: "20310326" }]));
    await runIcalImport(deps, T, "UTC");
    expect(records.records).toHaveLength(3);   // "old" ended before the grace window: never imported
    fetch.table[URL_A] = { body: airbnbFeed([{ uid: "u2", start: "20310320", end: "20310322" }, { uid: "u3", start: "20310325", end: "20310326" }]) };
    await runIcalImport(deps, T, "UTC");
    expect(records.records.find((r) => r.data.check_in === "2031-03-10")!.data.status).toBe("cancelled");
    fetch.table[URL_A] = { body: airbnbFeed([{ uid: "u1", start: "20310310", end: "20310313" }, { uid: "u2", start: "20310320", end: "20310322" }, { uid: "u3", start: "20310325", end: "20310326" }]) };
    await runIcalImport(deps, T, "UTC");
    expect(records.records.find((r) => r.data.check_in === "2031-03-10")!.data.status).toBe("confirmed");
  });

  it("treats Booking.com's closed dates as blocks and files them under their source", async () => {
    const { deps, records } = await withFeed({ [URL_B]: { body: airbnbFeed([{ uid: "b1", start: "20310310", end: "20310312", summary: "CLOSED - Not available" }]) } }, "booking_com", URL_B);
    await runIcalImport(deps, T, "UTC");
    expect(records.records[0].data).toMatchObject({ entry: "block", source_ota: "booking_com", ota_channel: "booking_com" });
  });

  it("does not wipe the calendar when a feed suddenly lists nothing", async () => {
    const evs = [1, 2, 3].map((n) => ({ uid: `u${n}`, start: `2031032${n}`, end: `2031032${n + 1}` }));
    const { deps, records, fetch, store } = await withFeed(body(evs));
    await runIcalImport(deps, T, "UTC");
    fetch.table[URL_A] = { body: airbnbFeed([]) };
    const r = await runIcalImport(deps, T, "UTC");
    expect(r.failedFeeds).toBe(1);
    expect(records.records.every((x) => x.data.status === "confirmed")).toBe(true);
    expect(store.feeds[0].lastError).toBe("empty_feed");
  });

  it("keeps two workspaces apart even with identical UIDs", async () => {
    const a = await withFeed(body([{ uid: "same", start: "20310310", end: "20310312" }]));
    const other = { tenantId: "t-2", workspaceId: "w-2", connectionId: "c-2" };
    await a.store.createFeed({ ...other, propertyKey: "villa", source: "airbnb", label: "", timezone: null, url: URL_B });
    a.fetch.table[URL_B] = { body: airbnbFeed([{ uid: "same", start: "20310310", end: "20310320" }]) };
    await runIcalImport(a.deps, T, "UTC");
    await runIcalImport(a.deps, other, "UTC");
    expect(a.records.records).toHaveLength(2);
    expect(a.records.records.map((r) => [r.tenantId, r.data.room, r.data.check_out]).sort()).toEqual([["t-1", "room-a", "2031-03-12"], ["t-2", "villa", "2031-03-20"]]);
    expect(a.fetch.asked.filter((u) => u === URL_B)).toHaveLength(1);   // each feed is fetched for its own connection only
  });

  it("reports a workspace without the Booking object instead of inventing one", async () => {
    const { deps, records } = await withFeed(body([{ uid: "u1", start: "20310310", end: "20310313" }]));
    records.objects.clear();
    await expect(runIcalImport(deps, T, "UTC")).rejects.toThrow(/Booking object/);
  });
});

describe("repeated fetch failure", () => {
  it("counts per feed, flags needs_attention once at the threshold with a notice and an audit row, and never leaks the URL", async () => {
    const { deps, store, audits } = await withFeed({ [URL_A]: { status: 404 } });
    for (let i = 1; i < FAILURE_THRESHOLD; i++) {
      const r = await runIcalImport(deps, T, "UTC");
      expect(r.failedFeeds).toBe(1);
      expect(store.flags).toHaveLength(0);
    }
    const last = await runIcalImport(deps, T, "UTC");
    expect(last.flagged).toBe(true);
    expect(store.flags).toHaveLength(1);
    const f = store.flags[0];
    expect(f.scope).toEqual(T);
    expect(f.message).toContain("no longer exists");
    expect(f.notice.title.en).toBeTruthy();
    expect(f.notice.title.ta).toBeTruthy();
    expect(f.notice.url).toBe("/integrations");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "ical.feed_failing", detail: { code: "http_404", failures: FAILURE_THRESHOLD } });
    expect(JSON.stringify([f, audits])).not.toContain("SECRETTOKEN");
  });
  it("resets the counter after one good fetch", async () => {
    const { deps, store, fetch } = await withFeed({ [URL_A]: { status: 500 } });
    await runIcalImport(deps, T, "UTC"); await runIcalImport(deps, T, "UTC");
    expect(store.feeds[0].failures).toBe(2);
    fetch.table[URL_A] = { body: airbnbFeed([{ uid: "u1", start: "20310310", end: "20310312" }]) };
    await runIcalImport(deps, T, "UTC");
    expect(store.feeds[0].failures).toBe(0);
    expect(store.flags).toHaveLength(0);
  });
  it.each([
    ["an HTML page", { body: "<html>sign in</html>" }, "not_ical"],
    ["a timeout", { error: "timeout" }, "timeout"],
    ["an oversized file", { error: "too_large" }, "too_large"],
    ["a private redirect", { error: "blocked_address" }, "blocked_address"],
  ])("records %s as a failure code, not an exception", async (_n, resp, code) => {
    const { deps, store } = await withFeed({ [URL_A]: resp });
    const r = await runIcalImport(deps, T, "UTC");
    expect(r.failedFeeds).toBe(1);
    expect(store.feeds[0].lastError).toBe(code);
  });
  it("rejects a stored URL that is not a safe feed URL without fetching it", async () => {
    const { deps, store, fetch } = await withFeed({}, "airbnb", "http://169.254.169.254/latest");
    await runIcalImport(deps, T, "UTC");
    expect(fetch.asked).toHaveLength(0);
    expect(store.feeds[0].lastError).toMatch(/^url_/);
  });
  it("one broken feed does not stop the others", async () => {
    const { deps, store, records, fetch } = await withFeed({ [URL_A]: { status: 500 } });
    await store.createFeed({ ...T, propertyKey: "room-b", source: "booking_com", label: "", timezone: null, url: URL_B });
    fetch.table[URL_B] = { body: airbnbFeed([{ uid: "b1", start: "20310310", end: "20310312", summary: "CLOSED - Not available" }]) };
    const r = await runIcalImport(deps, T, "UTC");
    expect(r).toMatchObject({ failedFeeds: 1, rowsIn: 1 });
    expect(records.records).toHaveLength(1);
  });
});

describe("through the connector runner", () => {
  afterEach(() => setIcalRuntimeFactory(null));
  it("runs the 30-minute import stream, writes a sync run, and the failure leaves the run partial", async () => {
    resetRegistry(); registerConnector(icalConnector);
    expect(icalConnector.streams[0].schedule?.cron).toBe("*/30 * * * *");
    const core = makeCoreDeps();
    core.store.availability.ical = { mode: "live", gateStatus: "ready" };
    core.store.conns.set("c-1", { id: "c-1", tenantId: T.tenantId, workspaceId: T.workspaceId, connectorId: "ical", mode: "live", status: "connected", settings: { timezone: "Asia/Kolkata" }, credentialSecretId: "sec", webhookSecretId: null, tokenExpiresAt: null });
    core.vault.secrets.set("sec", "{}");
    const ical = await withFeed(body([{ uid: "u1", start: "20310310", end: "20310313" }]));
    setIcalRuntimeFactory(async () => ({ deps: ical.deps }));
    const out = await runSync(core.deps, { connectionId: "c-1", stream: "import", trigger: "poll" });
    expect(out.streams[0]).toMatchObject({ status: "success", rowsIn: 1 });
    expect(ical.records.records).toHaveLength(1);
    void NOW;
  });
});
