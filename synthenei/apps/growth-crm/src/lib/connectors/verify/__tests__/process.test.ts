import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeStore, FakeVault, makeDeps } from "../../core/__tests__/fakes";
import { mockConnector } from "../../core/mock";
import { registerConnector, resetRegistry } from "../../registry";
import type { ConnectionRow, ConnectorDef } from "../../core/types";
import { processInbound, replayInbound, type InboxRow, type ProcessStore } from "../process";

class Inbox implements ProcessStore {
  rows = new Map<number, InboxRow & { error?: string | null }>();
  async getInbox(id: number) { return this.rows.get(id) ?? null; }
  async mark(id: number, status: InboxRow["status"], error: string | null) { Object.assign(this.rows.get(id)!, { status, error }); }
}

let store: FakeStore, inbox: Inbox, handled: unknown[], failWith: string | null;
const conn: ConnectionRow = { id: "c1", tenantId: "t", workspaceId: "w", connectorId: "mock", mode: "sandbox", status: "sandbox", settings: {}, credentialSecretId: null, webhookSecretId: null, tokenExpiresAt: null };
const row = (o: Partial<InboxRow> = {}): InboxRow => ({ id: 1, connectorId: "mock", integrationId: "c1", signatureOk: true, status: "queued", headers: {}, body: '{"events":[{"id":"a"},{"id":"b"}]}', ...o });
const def = (over: Partial<ConnectorDef> = {}): ConnectorDef => ({
  ...mockConnector,
  webhook: {
    async verify(r) { return (JSON.parse(r.rawBody) as { events: unknown[] }).events; },
    async handle(_ctx, evt) { if (failWith) throw new Error(failWith); handled.push(evt); },
  },
  ...over,
});

beforeEach(() => {
  store = new FakeStore(); inbox = new Inbox(); handled = []; failWith = null;
  store.conns.set("c1", { ...conn });
  registerConnector(def());
});
afterEach(() => resetRegistry());
const d = () => makeDeps({ store, vault: new FakeVault() }).deps;

describe("processInbound", () => {
  it("parses and handles each event once, marks processed, writes a webhook sync run; a second call is a no-op", async () => {
    inbox.rows.set(1, row());
    expect(await processInbound(d(), inbox, 1), String(inbox.rows.get(1)?.error)).toBe("processed");
    expect(handled).toHaveLength(2);
    expect(inbox.rows.get(1)?.status).toBe("processed");
    expect(store.runs[0]).toMatchObject({ kind: "webhook", status: "success", rowsIn: 2 });
    expect(await processInbound(d(), inbox, 1)).toBe("skipped");
    expect(handled).toHaveLength(2);
  });
  it("a handler failure leaves a visible failed row with a scrubbed error and a failed run; replay requeues it", async () => {
    inbox.rows.set(1, row());
    failWith = "boom sk_live_abcdef1234567890SECRET leaked";
    expect(await processInbound(d(), inbox, 1)).toBe("failed");
    const r = inbox.rows.get(1)!;
    expect(r.status).toBe("failed");
    expect(r.error).not.toContain("abcdef1234567890SECRET");
    expect(store.runs[0].status).toBe("failed");
    expect(await replayInbound(inbox, 1)).toBe(true);
    expect(inbox.rows.get(1)?.status).toBe("queued");
    failWith = null;
    expect(await processInbound(d(), inbox, 1)).toBe("processed");
  });
  it("ignores unverified rows, missing connections, disconnected connections and connectors without a handler", async () => {
    inbox.rows.set(1, row({ signatureOk: false, body: null }));
    expect(await processInbound(d(), inbox, 1)).toBe("ignored");
    inbox.rows.set(2, row({ id: 2, integrationId: "zzz" }));
    expect(await processInbound(d(), inbox, 2)).toBe("ignored");
    store.conns.set("c1", { ...conn, status: "disconnected" });
    inbox.rows.set(3, row({ id: 3 }));
    expect(await processInbound(d(), inbox, 3)).toBe("ignored");
    store.conns.set("c1", { ...conn });
    registerConnector(def({ webhook: undefined }));
    inbox.rows.set(4, row({ id: 4 }));
    expect(await processInbound(d(), inbox, 4)).toBe("ignored");
    expect(handled).toHaveLength(0);
  });
  it("replay refuses rows that were never verified", async () => {
    inbox.rows.set(1, row({ signatureOk: false, body: null }));
    expect(await replayInbound(inbox, 1)).toBe(false);
    expect(await replayInbound(inbox, 99)).toBe(false);
  });
});
