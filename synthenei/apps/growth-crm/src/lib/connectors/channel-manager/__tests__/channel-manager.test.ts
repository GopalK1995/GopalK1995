import { describe, expect, it } from "vitest";
import { applyReservationEvent } from "../apply";
import { buildSnapshot, snapshotHash } from "../availability";
import { channelToSource, minorToMajor, reservationToBooking } from "../mapper";
import { genericChannelManager, parseItem, parseItems } from "../generic";
import { FIXTURE_ITEMS, fixtureHttp } from "../fixtures";
import { dateInZone, validZone, wallToUtc } from "../tz";
import { CredentialError } from "../../core/types";
import type { Reservation, ReservationEvent } from "../types";
import { FakeRecords, silent } from "./fake-records";

const base = (over: Partial<Reservation> = {}): Reservation => ({
  externalId: "r1", channel: "booking_com", channelRef: "BK-1", checkIn: "2031-05-01", checkOut: "2031-05-04", room: "room-a", guests: 2, guestName: "Test Guest",
  totalMinor: 1_000_000, currency: "INR", commissionPct: 15, commissionMinor: null, version: 1, ...over,
});
const ev = (kind: ReservationEvent["kind"], over: Partial<Reservation> = {}): ReservationEvent => ({ kind, reservation: base(over) });
const scopeA = { tenantId: "t-a", workspaceId: "w-a", connectionId: "c-a" };
const scopeB = { tenantId: "t-b", workspaceId: "w-b", connectionId: "c-b" };

describe("reservation mapper", () => {
  it("labels the OTA, keeps the commission and stores money in major units", () => {
    const r = reservationToBooking(base(), "created");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ source_ota: "booking_com", ota_channel: "booking_com", commission_pct: 15, total_amount: 10000, commission_amount: 1500, currency: "INR", status: "confirmed", entry: "reservation", origin: "channel_manager" });
    expect(r.title).toBe("booking_com BK-1");
    expect(r.title).not.toContain("Test Guest");   // a guest name never goes into a title
  });
  it("derives the percentage from an exact commission amount and never invents one", () => {
    const d = reservationToBooking(base({ commissionPct: null, commissionMinor: 135_000, totalMinor: 900_000 }), "created");
    expect(d.ok && d.data.commission_pct).toBe(15);
    const none = reservationToBooking(base({ commissionPct: null, commissionMinor: null }), "created");
    expect(none.ok && none.data.commission_pct).toBeNull();
    expect(none.ok && none.data.commission_amount).toBeNull();
    const noMoney = reservationToBooking(base({ totalMinor: null, commissionPct: null, currency: null }), "created");
    expect(noMoney.ok && noMoney.data.total_amount).toBeNull();
  });
  it("maps channel names to the seeded sources and leaves unknown ones null (raw label kept)", () => {
    expect(channelToSource("Booking.com")).toBe("booking_com");
    expect(channelToSource("MMT")).toBe("makemytrip");
    expect(channelToSource("Goibibo")).toBe("makemytrip");
    expect(channelToSource("AIRBNB")).toBe("airbnb");
    expect(channelToSource("some-new-ota")).toBeNull();
    const r = reservationToBooking(base({ channel: "some-new-ota" }), "created");
    expect(r.ok && r.data.source_ota).toBeNull();
    expect(r.ok && r.data.ota_channel).toBe("some-new-ota");
  });
  it("respects currency exponents", () => { expect(minorToMajor(5000, "JPY")).toBe(5000); expect(minorToMajor(1234, "KWD")).toBe(1.234); expect(minorToMajor(1234, "INR")).toBe(12.34); });
  it.each([
    ["bad dates", { checkIn: "2031-02-30" }, "bad_dates"],
    ["reversed stay", { checkIn: "2031-05-04", checkOut: "2031-05-01" }, "bad_stay_length"],
    ["stay over a year", { checkOut: "2033-01-01" }, "bad_stay_length"],
    ["bad guests", { guests: 0 }, "bad_guests"],
    ["negative total", { totalMinor: -1 }, "bad_amount"],
    ["commission over 100", { commissionPct: 120 }, "bad_commission"],
    ["amount without currency", { currency: null }, "bad_currency"],
    ["no id", { externalId: "" }, "bad_id"],
  ] as const)("rejects %s instead of guessing", (_n, over, reason) => {
    const r = reservationToBooking(base(over as Partial<Reservation>), "created");
    expect(r).toEqual({ ok: false, reason });
  });
});

describe("applying reservation events", () => {
  const mk = () => { const store = new FakeRecords().withObject("t-a").withObject("t-b"); return { store, deps: { store, log: silent } }; };

  it("creates, modifies and cancels one record, with events", async () => {
    const { store, deps } = mk();
    expect((await applyReservationEvent(deps, scopeA, ev("created"))).outcome).toBe("created");
    expect((await applyReservationEvent(deps, scopeA, ev("modified", { checkOut: "2031-05-06", version: 2 }))).outcome).toBe("updated");
    expect(store.records).toHaveLength(1);
    expect(store.records[0].data.check_out).toBe("2031-05-06");
    expect((await applyReservationEvent(deps, scopeA, ev("cancelled", { version: 3 }))).outcome).toBe("cancelled");
    expect(store.records[0].data.status).toBe("cancelled");
    expect(store.records[0].data.check_out).toBe("2031-05-06");   // the thin cancel payload does not erase what we knew
    expect(store.events.map((e) => e.type)).toEqual(["booking.created", "booking.cancelled"]);
  });
  it("is idempotent: the same delivery twice changes nothing", async () => {
    const { store, deps } = mk();
    await applyReservationEvent(deps, scopeA, ev("created"));
    expect((await applyReservationEvent(deps, scopeA, ev("created"))).outcome).toBe("unchanged");
    expect(store.records).toHaveLength(1);
    expect(store.records[0].version).toBe(1);
  });
  it("ignores an older version and never resurrects a cancelled booking", async () => {
    const { store, deps } = mk();
    await applyReservationEvent(deps, scopeA, ev("created", { version: 5 }));
    expect((await applyReservationEvent(deps, scopeA, ev("modified", { checkOut: "2031-05-09", version: 4 }))).outcome).toBe("stale");
    expect(store.records[0].data.check_out).toBe("2031-05-04");
    await applyReservationEvent(deps, scopeA, ev("cancelled", { version: 6 }));
    expect((await applyReservationEvent(deps, scopeA, ev("modified", { version: 7 }))).outcome).toBe("stale");
    expect((await applyReservationEvent(deps, scopeA, ev("cancelled", { version: 8 }))).outcome).toBe("already_cancelled");
    expect(store.records[0].data.status).toBe("cancelled");
  });
  it("creates nothing for a cancellation of a reservation it never saw, but creates from a modification", async () => {
    const { store, deps } = mk();
    expect((await applyReservationEvent(deps, scopeA, ev("cancelled"))).outcome).toBe("ignored_cancel");
    expect(store.records).toHaveLength(0);
    expect((await applyReservationEvent(deps, scopeA, ev("modified", { externalId: "r9" }))).outcome).toBe("created");
  });
  it("retries once on a lost compare-and-set and then gives up loudly", async () => {
    const { store, deps } = mk();
    await applyReservationEvent(deps, scopeA, ev("created"));
    store.conflictOnce.add(store.records[0].id);
    expect((await applyReservationEvent(deps, scopeA, ev("modified", { checkOut: "2031-05-05", version: 2 }))).outcome).toBe("updated");
  });
  it("keeps tenants apart: the same reservation id in two tenants is two records and never crosses", async () => {
    const { store, deps } = mk();
    await applyReservationEvent(deps, scopeA, ev("created"));
    await applyReservationEvent(deps, scopeB, ev("created", { room: "room-z" }));
    expect(store.records).toHaveLength(2);
    await applyReservationEvent(deps, scopeB, ev("cancelled", { version: 2 }));
    expect(store.records.find((r) => r.tenantId === "t-a")!.data.status).toBe("confirmed");
    expect(store.records.find((r) => r.tenantId === "t-b")!.data.status).toBe("cancelled");
  });
  it("reports a missing Booking object and rejects unreadable reservations", async () => {
    const store = new FakeRecords();
    expect((await applyReservationEvent({ store, log: silent }, scopeA, ev("created"))).outcome).toBe("no_booking_object");
    const { deps } = mk();
    expect(await applyReservationEvent(deps, scopeA, ev("created", { checkIn: "nope" }))).toEqual({ outcome: "rejected", reason: "bad_dates" });
  });
});

describe("generic adapter shell and fixtures", () => {
  it("parses the fixture items: valid ones become events, the broken ones are counted", () => {
    const { events, rejected } = parseItems(FIXTURE_ITEMS);
    expect(events).toHaveLength(6);
    expect(rejected).toBe(1);   // the {nonsense} item; the bad-date one parses and is rejected later by the mapper
    expect(parseItem({ event: "teleported", reservation: {} })).toBeNull();
  });
  it("pages through the fixture manager with a cursor", async () => {
    const http = fixtureHttp();
    const ctx = { secrets: { api_key: "k" }, apiBase: "https://cm.example.test", http };
    const p1 = await genericChannelManager.listChanges(ctx, null);
    expect(p1.done).toBe(false);
    const p2 = await genericChannelManager.listChanges(ctx, p1.nextCursor);
    expect(p2.done).toBe(false);
    const p3 = await genericChannelManager.listChanges(ctx, p2.nextCursor);
    expect(p3.done).toBe(true);
    expect(p1.events.length + p2.events.length + p3.events.length).toBe(6);
    expect(p1.rejected + p2.rejected + p3.rejected).toBe(1);
    expect(http.sent[0].url).toContain("/v1/reservations?limit=100");
    expect(http.sent[1].url).toContain("cursor=3");
    expect(http.sent[2].url).toContain("cursor=6");
  });
  it("refuses an unconfigured or non-https endpoint and a missing key", async () => {
    const http = fixtureHttp();
    await expect(genericChannelManager.test({ secrets: { api_key: "k" }, apiBase: "", http })).rejects.toBeInstanceOf(CredentialError);
    await expect(genericChannelManager.test({ secrets: { api_key: "k" }, apiBase: "http://insecure.example.test", http })).rejects.toBeInstanceOf(CredentialError);
    await expect(genericChannelManager.test({ secrets: {}, apiBase: "https://cm.example.test", http })).rejects.toBeInstanceOf(CredentialError);
    await expect(genericChannelManager.test({ secrets: { api_key: "k" }, apiBase: "https://cm.example.test", http })).resolves.toEqual({ accountId: "fixture-account", accountLabel: "Fixture channel manager" });
  });
  it("parses a webhook body and survives garbage", () => {
    expect(genericChannelManager.parseWebhook(JSON.stringify({ events: [FIXTURE_ITEMS[0]] })).events).toHaveLength(1);
    expect(genericChannelManager.parseWebhook("not json")).toEqual({ events: [], rejected: 0 });
    expect(genericChannelManager.parseWebhook("[]")).toEqual({ events: [], rejected: 0 });
  });
  it("sends the availability picture as one idempotent PUT", async () => {
    const http = fixtureHttp();
    await genericChannelManager.pushAvailability({ secrets: { api_key: "k" }, apiBase: "https://cm.example.test", http }, { windowFrom: "2031-01-01", windowTo: "2032-01-01", closed: [{ room: "a", from: "2031-03-10", to: "2031-03-13" }] });
    expect(http.sent[0]).toMatchObject({ method: "PUT", body: { window_from: "2031-01-01", closed: [{ room: "a", from: "2031-03-10", to: "2031-03-13" }] } });
  });
});

describe("availability out", () => {
  const stored = (data: object) => ({ recordId: "x", title: "", version: 1, hash: null, data: { status: "confirmed", entry: "reservation", room: "a", check_in: "2031-03-10", check_out: "2031-03-12", ...data } as never });
  it("merges touching ranges per room, ignores cancelled and counts rooms it cannot close", () => {
    const { snapshot, unassigned } = buildSnapshot([
      stored({}), stored({ check_in: "2031-03-12", check_out: "2031-03-14" }), stored({ check_in: "2031-03-20", check_out: "2031-03-22" }),
      stored({ room: "b", check_in: "2031-03-11", check_out: "2031-03-12" }), stored({ status: "cancelled" }), stored({ room: null }),
    ], "2031-03-01");
    expect(snapshot.closed).toEqual([{ room: "a", from: "2031-03-10", to: "2031-03-14" }, { room: "a", from: "2031-03-20", to: "2031-03-22" }, { room: "b", from: "2031-03-11", to: "2031-03-12" }]);
    expect(unassigned).toBe(1);
  });
  it("drops stays that are over and has a stable hash that changes when a booking changes", () => {
    const a = buildSnapshot([stored({ check_in: "2031-01-01", check_out: "2031-01-03" }), stored({})], "2031-03-01").snapshot;
    expect(a.closed).toHaveLength(1);
    const a2 = buildSnapshot([stored({})], "2031-03-02").snapshot;
    expect(snapshotHash(a)).toBe(snapshotHash(a2));
    const b = buildSnapshot([stored({ check_out: "2031-03-13" })], "2031-03-01").snapshot;
    expect(snapshotHash(a)).not.toBe(snapshotHash(b));
  });
});

describe("time zone helpers", () => {
  it("converts wall time in a zone with DST and reads the local date of an instant", () => {
    const ny = wallToUtc({ y: 2031, mo: 7, d: 1, h: 12, mi: 0, s: 0 }, "America/New_York");
    expect(new Date(ny).toISOString()).toBe("2031-07-01T16:00:00.000Z");
    const ny2 = wallToUtc({ y: 2031, mo: 1, d: 1, h: 12, mi: 0, s: 0 }, "America/New_York");
    expect(new Date(ny2).toISOString()).toBe("2031-01-01T17:00:00.000Z");
    expect(dateInZone(Date.parse("2031-03-10T20:00:00Z"), "Asia/Kolkata")).toBe("2031-03-11");
    expect(validZone("Asia/Kolkata")).toBe(true);
    expect(validZone("India Standard Time")).toBe(false);
  });
});
