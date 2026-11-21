// End to end through the connector framework runner (runSync) with fakes: fixtures in, booking records out, availability out.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerConnector, resetRegistry } from "../../registry";
import { makeDeps } from "../../core/__tests__/fakes";
import { runSync } from "../../core/sync";
import type { ConnectionRow } from "../../core/types";
import { channelManagerConnector, setChannelManagerRuntimeFactory, useFixtures } from "../connector";
import { CM_FIXTURE_TOKEN } from "../constants";
import { genericChannelManager } from "../generic";
import type { AvailabilitySnapshot } from "../types";
import { FakeRecords, silent } from "./fake-records";

function setup(env: Record<string, string | undefined> = { APP_ENV: "staging" }, secrets: Record<string, string> = { api_key: CM_FIXTURE_TOKEN }) {
  const { deps, store, vault } = makeDeps();
  const records = new FakeRecords().withObject("t-1");
  store.availability["channel-manager"] = { mode: "sandbox", gateStatus: "ready" };
  const conn: ConnectionRow = { id: "conn-cm", tenantId: "t-1", workspaceId: "w-1", connectorId: "channel-manager", mode: "sandbox", status: "sandbox", settings: {}, credentialSecretId: "sec-x", webhookSecretId: null, tokenExpiresAt: null };
  store.conns.set(conn.id, conn);
  vault.secrets.set("sec-x", JSON.stringify(secrets));
  const pushes: AvailabilitySnapshot[] = [];
  const adapter = { ...genericChannelManager, async pushAvailability(c: Parameters<typeof genericChannelManager.pushAvailability>[0], s: AvailabilitySnapshot) { pushes.push(s); return genericChannelManager.pushAvailability(c, s); } };
  setChannelManagerRuntimeFactory(async () => ({ store: records, log: silent, now: () => new Date("2031-03-01T10:00:00Z"), env, adapter }));
  return { deps, store, records, pushes };
}

beforeEach(() => { resetRegistry(); registerConnector(channelManagerConnector); });
afterEach(() => setChannelManagerRuntimeFactory(null));

describe("channel-manager connector", () => {
  it("pulls the fixture reservations into booking records and is idempotent on the next poll", async () => {
    const { deps, store, records } = setup();
    const out = await runSync(deps, { connectionId: "conn-cm", stream: "reservations", trigger: "manual" });
    expect(out.streams[0].status).toBe("partial");           // one fixture row is deliberately broken
    expect(out.streams[0].rowsRejected).toBeGreaterThan(0);
    expect(records.records).toHaveLength(3);
    const byRef = Object.fromEntries(records.records.map((r) => [r.data.external_ref, r.data]));
    expect(byRef["BK-55001"]).toMatchObject({ source_ota: "booking_com", commission_pct: 15, check_out: "2031-03-14", status: "confirmed", total_amount: 20000 });
    expect(byRef["MM-77002"]).toMatchObject({ source_ota: "makemytrip", commission_pct: 15, status: "cancelled" });
    expect(byRef["HM-99003"]).toMatchObject({ source_ota: "airbnb", commission_pct: 3 });
    const before = JSON.stringify(records.records);
    await runSync(deps, { connectionId: "conn-cm", stream: "reservations", trigger: "manual" });
    expect(JSON.stringify(records.records)).toBe(before);
    expect(store.runs.every((r) => !JSON.stringify(r.payloadSample).includes("Test Guest"))).toBe(true);   // no guest names in sync samples
  });

  it("pushes availability once and skips the push when nothing changed", async () => {
    const { deps, store, records, pushes } = setup();
    records.addManual("t-1", "w-1", { room: "room-a", check_in: "2031-03-10", check_out: "2031-03-13" });
    await runSync(deps, { connectionId: "conn-cm", stream: "availability", trigger: "manual" });
    expect(store.cursors.get("conn-cm:availability")).toMatchObject({ hash: expect.any(String) });
    const first = JSON.stringify(store.cursors.get("conn-cm:availability"));
    const out = await runSync(deps, { connectionId: "conn-cm", stream: "availability", trigger: "manual" });
    expect(out.streams[0].status).toBe("success");
    expect(JSON.stringify(store.cursors.get("conn-cm:availability"))).toBe(first);
    expect(pushes).toHaveLength(1);
    records.addManual("t-1", "w-1", { room: "room-a", check_in: "2031-03-20", check_out: "2031-03-21" });
    await runSync(deps, { connectionId: "conn-cm", stream: "availability", trigger: "manual" });
    expect(JSON.stringify(store.cursors.get("conn-cm:availability"))).not.toBe(first);
    expect(pushes).toHaveLength(2);
    expect(pushes[1].closed).toEqual([{ room: "room-a", from: "2031-03-10", to: "2031-03-13" }, { room: "room-a", from: "2031-03-20", to: "2031-03-21" }]);
  });

  it("refuses the sandbox token in production and flips the connection to needs_attention", async () => {
    const { deps, store } = setup({ APP_ENV: "production" });
    const out = await runSync(deps, { connectionId: "conn-cm", stream: "reservations", trigger: "manual" });
    expect(out.streams[0].status).toBe("failed");
    expect(store.conns.get("conn-cm")!.status).toBe("needs_attention");
    expect(() => useFixtures({ api_key: CM_FIXTURE_TOKEN }, { APP_ENV: "production" })).toThrow();
    expect(useFixtures({ api_key: "real-key" }, { APP_ENV: "production" })).toBe(false);
    expect(useFixtures({}, { APP_ENV: "demo" })).toBe(true);
  });

  it("explains a workspace without the Booking object instead of inventing one", async () => {
    const { deps, store, records } = setup();
    records.objects.clear();
    const out = await runSync(deps, { connectionId: "conn-cm", stream: "reservations", trigger: "manual" });
    expect(out.streams[0].status).toBe("failed");
    expect(out.streams[0].error).toContain("Booking object");
    expect(store.conns.get("conn-cm")!.status).toBe("sandbox");   // not a credential problem
  });

  it("applies a webhook delivery through the same path", async () => {
    const { records } = setup();
    const events = await channelManagerConnector.webhook!.verify({ rawBody: JSON.stringify({ events: [{ event: "created", reservation: { id: "w1", channel: "airbnb", check_in: "2031-06-01", check_out: "2031-06-03", room: "room-a", version: 1 } }] }), headers: {} }, {});
    expect(events).toHaveLength(1);
    const conn = (await makeConn());
    await channelManagerConnector.webhook!.handle({ conn } as never, events[0]);
    await channelManagerConnector.webhook!.handle({ conn } as never, events[0]);
    expect(records.records).toHaveLength(1);
    expect(records.records[0].data.source_ota).toBe("airbnb");
  });
});

async function makeConn(): Promise<ConnectionRow> {
  return { id: "conn-cm", tenantId: "t-1", workspaceId: "w-1", connectorId: "channel-manager", mode: "sandbox", status: "sandbox", settings: {}, credentialSecretId: "x", webhookSecretId: null, tokenExpiresAt: null };
}
