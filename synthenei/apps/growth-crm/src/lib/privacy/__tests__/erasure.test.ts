import { describe, expect, it } from "vitest";
import { reportNote, runErasure, scrubRecordData, piiKeys } from "../erasure";
import { fakeDb } from "./fake-db";

const LEAD = "30000000-0000-4000-8000-000000000001", WS = "20000000-0000-4000-8000-000000000001", REQ = "40000000-0000-4000-8000-000000000001";
const leadRow = { id: LEAD, full_name: "Asha Rao", email: "asha@example.com", contact_id: "c-1", deleted_at: null };

function run(over: { user?: Parameters<typeof fakeDb>[0]; svc?: Parameters<typeof fakeDb>[0]; auditFails?: boolean } = {}) {
  const user = fakeDb({ tables: { leads: [leadRow] }, ...over.user });
  const svc = fakeDb({ tables: { contacts: [{ id: "c-1", email: "asha@example.com" }], record_links: [{ to_id: "r-1" }], records: [{ id: "r-1", object_type_id: "ot-1", data: { guest_phone: "1", nights: 2 } }], field_defs: [{ object_type_id: "ot-1", key: "guest_phone", is_pii: true }], embeddings: [{ id: "e1" }], external_links: [{ integration_id: "i-1" }], integrations: [{ connector_id: "zoho-crm" }], payments: [], reviews: [], calendar_events: [] }, ...over.svc });
  const audits: string[] = [];
  const order: string[] = [];
  const p = runErasure({
    user: user.db, svc: svc.db, workspaceId: WS,
    audit: async (a) => { audits.push(a); if (over.auditFails && a === "privacy.erasure_started") throw new Error("audit down"); },
  }, { requestId: REQ, leadId: LEAD });
  return { p, user, svc, audits, order };
}

describe("runErasure", () => {
  it("audits first, erases through erase_lead on the owner's client, then extends on the service client", async () => {
    const r = run();
    const rep = await r.p;
    expect(r.audits).toEqual(["privacy.erasure_started", "privacy.erasure_completed"]);
    const rpcs = r.user.ops.filter((o) => o.op === "rpc");
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].table).toBe("rpc:erase_lead");
    expect(rpcs[0].payload).toMatchObject({ p_lead: LEAD });
    expect(r.svc.ops.some((o) => o.op === "rpc")).toBe(false);   // the service client never calls erase_lead
    expect(rep.steps.map((s) => s.id)).toEqual(["erase_lead", "contacts", "records", "embeddings", "calendar_events", "reviews", "external_links", "payments", "suppression_list", "social_metrics"]);
    expect(rep.complete).toBe(true);
  });
  it("is never a blind delete: nothing is removed from a business table, only embeddings are deleted", async () => {
    const r = run();
    await r.p;
    const deletes = [...r.user.ops, ...r.svc.ops].filter((o) => o.op === "delete");
    expect(deletes.length).toBeGreaterThan(0);
    expect(new Set(deletes.map((d) => d.table))).toEqual(new Set(["embeddings"]));
    for (const d of deletes) expect(d.filters.some(([k, v]) => k === "eq:workspace_id" && v === WS)).toBe(true);
  });
  it("aborts before anything changes when the start audit fails", async () => {
    const r = run({ auditFails: true });
    await expect(r.p).rejects.toThrow("audit down");
    expect([...r.user.ops, ...r.svc.ops].filter((o) => o.op !== "select")).toHaveLength(0);
  });
  it("stops with no extension writes when erase_lead refuses (not an owner)", async () => {
    const r = run({ user: { tables: { leads: [leadRow] }, rpc: { erase_lead: { error: { code: "42501" } } } } });
    await expect(r.p).rejects.toThrow("Only a workspace owner can erase");
    expect(r.svc.ops.filter((o) => o.op !== "select")).toHaveLength(0);
    expect(r.audits).toEqual(["privacy.erasure_started"]);
  });
  it("reports a failing step instead of hiding it, and does not mark the run complete", async () => {
    const r = run({ svc: { failOn: (op) => (op.table === "calendar_events" && op.op === "update" ? { code: "XX000" } : null) } });
    const rep = await r.p;
    expect(rep.steps.find((s) => s.id === "calendar_events")?.status).toBe("failed");
    expect(rep.complete).toBe(false);
    expect(rep.steps.find((s) => s.id === "embeddings")?.status).toBe("done");   // later steps still ran
  });
  it("lists the connected tools that still hold a copy", async () => {
    const rep = await run().p;
    const ext = rep.steps.find((s) => s.id === "external_links");
    expect(ext).toMatchObject({ status: "manual" });
    expect(ext?.detail).toContain("zoho-crm");
  });
  it("removes only personal fields from linked records", async () => {
    const r = run();
    await r.p;
    const upd = r.svc.ops.find((o) => o.table === "records" && o.op === "update");
    expect(upd?.payload).toMatchObject({ title: "Erased record", data: { nights: 2 } });
    expect((upd?.payload as { data: Record<string, unknown> }).data).not.toHaveProperty("guest_phone");
  });
  it("is scoped by workspace on every service write", async () => {
    const r = run();
    await r.p;
    for (const o of r.svc.ops.filter((x) => x.op === "update" || x.op === "delete")) expect(o.filters.some(([k, v]) => k === "eq:workspace_id" && v === WS)).toBe(true);
  });
  it("refuses a lead that is not in the workspace", async () => {
    const r = run({ user: { tables: { leads: [] } } });
    await expect(r.p).rejects.toThrow("lead not found");
  });
  it("reportNote has no personal data", async () => {
    const note = reportNote(await run().p);
    expect(note).toContain("erase_lead done");
    expect(note).not.toContain("asha");
    expect(note).not.toContain("Asha");
  });
});

describe("record scrubbing helpers", () => {
  it("piiKeys and scrubRecordData", () => {
    expect(piiKeys([{ key: "a", is_pii: true }, { key: "b", is_pii: false }, { key: "c" }])).toEqual(["a"]);
    expect(scrubRecordData({ a: 1, b: 2 }, ["a"])).toEqual({ b: 2 });
  });
});
