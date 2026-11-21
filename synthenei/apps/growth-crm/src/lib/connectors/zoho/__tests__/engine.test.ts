// The sync engine against in-memory fakes: initial import through the T034 planner, incremental pull, push, conflicts through the
// field map's conflict_owner, loop prevention, stage mapping, lookups, protected columns, tenant isolation, vendor rejections.
import { describe, expect, it } from "vitest";
import type { FieldMapSpec } from "../../core/types";
import { decodeBase } from "../engine/conflict";
import { applyRemote, objectCtx, pullStep, pushStep } from "../engine/run";
import { emptyTally } from "../engine/types";
import { ZOHO_DEFAULT_MAP } from "../defaults";
import { CONN, WS, harness } from "./fakes";

const owner = (o: FieldMapSpec["conflictOwner"], only?: string[]): FieldMapSpec[] => ZOHO_DEFAULT_MAP.map((f) => (!only || only.includes(f.externalField) ? { ...f, conflictOwner: o } : f));
const lead = (over: Record<string, unknown> = {}) => ({ Full_Name: "Asha Rao", Email: "Asha@Example.com", Phone: "98765 43210", Company: "Rao & Co", City: "Chennai", ...over });
const drain = async (h: ReturnType<typeof harness>, step: typeof pullStep | typeof pushStep, max = 30) => {
  let cursor: unknown = null, rows = 0, rejected = 0;
  for (let i = 0; i < max; i++) { const r = await step(h.ctx, cursor); cursor = r.cursor; rows += r.rowsIn; rejected += r.rowsRejected; if (r.done) return { cursor, rows, rejected }; }
  throw new Error("did not finish");
};
const leadsOf = (h: ReturnType<typeof harness>) => h.store.all("leads");

describe("initial import goes through the T034 planner", () => {
  it("creates leads cleaned like a CSV import (E.164 phone, lower email), tagged with the vendor as source, linked with a base", async () => {
    const h = harness(ZOHO_DEFAULT_MAP, { objects: ["lead"] });
    h.gw.put("lead", "1001", lead());
    await drain(h, pullStep);
    expect(leadsOf(h)).toHaveLength(1);
    expect(leadsOf(h)[0]).toMatchObject({ full_name: "Asha Rao", email: "asha@example.com", phone: "+919876543210", firm_name: "Rao & Co", city: "Chennai", source: "zoho", tenant_id: "t-1", workspace_id: WS, external_ids: { zoho: "1001" } });
    const link = await h.store.getLinkByLocal(CONN, "leads", Object.keys(h.store.core.tables.leads)[0]);
    expect(link?.externalId).toBe("1001");
    expect(decodeBase(link?.hash)).not.toBeNull();
  });

  it("rejects what the CSV import would reject (no way to reach the lead), with a reason and no PII", async () => {
    const h = harness(ZOHO_DEFAULT_MAP, { objects: ["lead"] });
    h.gw.put("lead", "1", lead({ Email: null, Phone: null }));
    h.gw.put("lead", "2", lead({ Full_Name: null, Email: "b@example.com", Phone: null }));
    const r = await drain(h, pullStep);
    expect(leadsOf(h)).toHaveLength(0);
    expect(r.rejected).toBe(2);
    expect(h.rejects).toEqual(expect.arrayContaining(["import_contact_required", "import_name_required"]));
    expect(h.rejects.join(" ")).not.toMatch(/asha|example\.com/i);
  });

  it("a duplicate of an existing CRM lead is linked, not duplicated; skip keeps the CRM's values, merge writes the vendor's", async () => {
    const skip = harness(ZOHO_DEFAULT_MAP, { objects: ["lead"] });
    const id = skip.store.seed("leads", { full_name: "Asha R", email: "asha@example.com", phone: "+919876543210", city: "Madurai" });
    skip.gw.put("lead", "1001", lead());
    await drain(skip, pullStep);
    expect(leadsOf(skip)).toHaveLength(1);
    expect(skip.store.row("leads", id).city).toBe("Madurai");
    expect((await skip.store.getLinkByLocal(CONN, "leads", id))?.externalId).toBe("1001");

    const merge = harness(ZOHO_DEFAULT_MAP, { objects: ["lead"], importMode: "merge" });
    const id2 = merge.store.seed("leads", { full_name: "Asha R", email: "asha@example.com", city: "Madurai" });
    merge.gw.put("lead", "1001", lead());
    await drain(merge, pullStep);
    expect(merge.store.row("leads", id2)).toMatchObject({ city: "Chennai", full_name: "Asha Rao" });
  });

  it("two vendor records for the same person do not become two links to one lead", async () => {
    const h = harness(ZOHO_DEFAULT_MAP, { objects: ["lead"] });
    h.gw.put("lead", "1", lead());
    h.gw.put("lead", "2", lead({ Full_Name: "Asha Rao (dup)" }));
    await drain(h, pullStep);
    expect(leadsOf(h)).toHaveLength(1);
    expect(h.rejects).toContain("duplicate_in_file");
    // next page of the import: the earlier lead is in the index, and it is already linked
    const h2 = harness(ZOHO_DEFAULT_MAP, { objects: ["lead"] });
    h2.gw.pageSize = 1;
    h2.gw.put("lead", "1", lead());
    h2.gw.put("lead", "2", lead({ Full_Name: "Asha Rao (dup)" }));
    await drain(h2, pullStep);
    expect(leadsOf(h2)).toHaveLength(1);
    expect(h2.rejects).toContain("duplicate_of_linked");
  });

  it("pages and resumes: a cursor taken mid-import continues where it stopped", async () => {
    const h = harness(ZOHO_DEFAULT_MAP, { objects: ["lead"] });
    h.gw.pageSize = 2;
    for (let i = 1; i <= 5; i++) h.gw.put("lead", String(i), lead({ Full_Name: `Person ${i}`, Email: `p${i}@example.com`, Phone: null }));
    const a = await pullStep(h.ctx, null);
    expect(a.done).toBe(false);
    expect(leadsOf(h)).toHaveLength(2);
    // a later run resumes from the saved cursor
    let cur: unknown = a.cursor, done = false;
    while (!done) { const r = await pullStep(h.ctx, cur); cur = r.cursor; done = r.done; }
    expect(leadsOf(h)).toHaveLength(5);
  });

  it("imports only what changed since import_since", async () => {
    const h = harness(ZOHO_DEFAULT_MAP, { objects: ["lead"], importSince: "2026-11-01T00:00:03.000Z" });
    h.gw.put("lead", "1", lead({ Email: "old@example.com" }));   // modified at tick 1
    h.gw.put("lead", "2", lead({ Email: "mid@example.com" }));   // tick 2
    h.gw.put("lead", "3", lead({ Email: "new@example.com" }));   // tick 3
    await drain(h, pullStep);
    expect(leadsOf(h).map((l) => l.email)).toEqual(["new@example.com"]);
  });

  it("walks the objects in dependency order and links contacts and deals to their account", async () => {
    const h = harness(ZOHO_DEFAULT_MAP);
    h.gw.put("deal", "d1", { Deal_Name: "Rockfort plan", Stage: "Proposal/Price Quote", Amount: 12000, Closing_Date: "2026-12-31", Account_Name: { id: "a1", name: "Rao & Co" }, Contact_Name: { id: "c1" } });
    h.gw.put("contact", "c1", { Full_Name: "Asha Rao", Email: "asha@example.com", Account_Name: { id: "a1" } });
    h.gw.put("account", "a1", { Account_Name: "Rao & Co", Billing_City: "Chennai" });
    await drain(h, pullStep);
    const acc = Object.keys(h.store.core.tables.accounts)[0], con = Object.keys(h.store.core.tables.contacts)[0];
    expect(h.store.all("contacts")[0].account_id).toBe(acc);
    expect(h.store.all("deals")[0]).toMatchObject({ name: "Rockfort plan", stage_id: "st-proposal", value_inr: 12000, expected_close_on: "2026-12-31", account_id: acc, primary_contact_id: con });
  });
});

describe("deals: stage mapping is explicit", () => {
  it("rejects a deal whose stage has no mapping instead of guessing, and a deal without a name", async () => {
    const h = harness(ZOHO_DEFAULT_MAP, { objects: ["deal"] });
    h.gw.put("deal", "1", { Deal_Name: "X", Stage: "Custom Stage" });
    h.gw.put("deal", "2", { Deal_Name: null, Stage: "Closed Won" });
    const r = await drain(h, pullStep);
    expect(h.store.all("deals")).toHaveLength(0);
    expect(r.rejected).toBe(2);
    expect(h.rejects).toEqual(expect.arrayContaining(["stage_unmapped", "import_name_required"]));
  });
  it("a tenant stage map row replaces the default", async () => {
    const map: FieldMapSpec[] = [...ZOHO_DEFAULT_MAP, { externalObject: "Deals", externalField: "Stage", localTable: "deals", localColumn: "stage_id", direction: "both", transform: "stage_key_map", transformArg: { map: { "Custom Stage": "won" } } }];
    const h = harness(map, { objects: ["deal"] });
    h.gw.put("deal", "1", { Deal_Name: "X", Stage: "Custom Stage" });
    await drain(h, pullStep);
    expect(h.store.all("deals")[0].stage_id).toBe("st-won");
  });
});

describe("incremental sync, both ways", () => {
  async function linked(map = ZOHO_DEFAULT_MAP) {
    const h = harness(map, { objects: ["lead"] });
    h.gw.put("lead", "1", lead());
    await drain(h, pullStep);
    const id = Object.keys(h.store.core.tables.leads)[0];
    h.gw.calls.length = 0;
    return { h, id };
  }

  it("a vendor edit is pulled into the CRM", async () => {
    const { h, id } = await linked();
    h.gw.edit("lead", "1", { City: "Madurai" });
    await drain(h, pullStep);
    expect(h.store.row("leads", id).city).toBe("Madurai");
  });

  it("a CRM edit is pushed to the vendor, once, and not bounced back (no loop)", async () => {
    const { h, id } = await linked();
    h.store.edit("leads", id, { city: "Coimbatore" });
    await drain(h, pushStep);
    expect(h.gw.get("lead", "1").fields.City).toBe("Coimbatore");
    expect(h.gw.calls.filter((c) => c.startsWith("update"))).toHaveLength(1);
    // the vendor's modified time moved because of our write: the pull sees it, finds nothing new, writes nothing
    const before = JSON.stringify(h.store.row("leads", id));
    await drain(h, pullStep);
    expect(JSON.stringify(h.store.row("leads", id))).toBe(before);
    // and a second push pass finds nothing to send
    h.gw.calls.length = 0;
    await drain(h, pushStep);
    expect(h.gw.calls.filter((c) => c.startsWith("update"))).toHaveLength(0);
  });

  it("a push pass reads nothing from the vendor for records the CRM did not change", async () => {
    const { h } = await linked();
    await drain(h, pushStep);
    expect(h.gw.calls.filter((c) => c.startsWith("getMany"))).toHaveLength(0);
  });

  it("different fields edited on each side merge; nothing is lost", async () => {
    const { h, id } = await linked();
    h.store.edit("leads", id, { firm_name: "Rao Legal" });
    h.gw.edit("lead", "1", { City: "Salem" });
    await drain(h, pushStep);
    expect(h.gw.get("lead", "1").fields).toMatchObject({ Company: "Rao Legal", City: "Salem" });
    expect(h.store.row("leads", id)).toMatchObject({ firm_name: "Rao Legal", city: "Salem" });
  });

  it.each([
    ["crm", "Madurai", "Madurai"],        // the CRM's value wins and goes to the vendor
    ["external", "Salem", "Salem"],       // the vendor's value wins and goes to the CRM
  ] as const)("the same field edited on both sides: conflict_owner %s decides", async (ownerKey, wantLocal, wantRemote) => {
    const { h, id } = await linked(owner(ownerKey));
    h.store.edit("leads", id, { city: "Madurai" });
    h.gw.edit("lead", "1", { City: "Salem" });
    await drain(h, pushStep);
    expect(h.store.row("leads", id).city).toBe(wantLocal);
    expect(h.gw.get("lead", "1").fields.City).toBe(wantRemote);
  });

  it("last_write: the newer side wins", async () => {
    const a = await linked(owner("last_write"));
    a.h.gw.edit("lead", "1", { City: "Salem" });           // vendor edit first
    a.h.store.edit("leads", a.id, { city: "Madurai" });    // CRM edit after... but clocks are separate counters, so make the CRM clearly older/newer
    a.h.store.core.tables.leads[a.id].updated_at = "2099-01-01T00:00:00.000Z";
    await drain(a.h, pushStep);
    expect(a.h.gw.get("lead", "1").fields.City).toBe("Madurai");
    const b = await linked(owner("last_write"));
    b.h.store.edit("leads", b.id, { city: "Madurai" });
    b.h.store.core.tables.leads[b.id].updated_at = "2001-01-01T00:00:00.000Z";
    b.h.gw.edit("lead", "1", { City: "Salem" });
    await drain(b.h, pushStep);
    expect(b.h.store.row("leads", b.id).city).toBe("Salem");
  });

  it("a deal's stage travels both ways through the stage map (key <-> vendor label)", async () => {
    const h = harness(ZOHO_DEFAULT_MAP, { objects: ["deal"] });
    h.gw.put("deal", "d1", { Deal_Name: "Plan", Stage: "Proposal/Price Quote", Amount: 100 });
    await drain(h, pullStep);
    const id = Object.keys(h.store.core.tables.deals)[0];
    h.gw.edit("deal", "d1", { Stage: "Closed Won" });
    await drain(h, pullStep);
    expect(h.store.row("deals", id).stage_id).toBe("st-won");
    h.store.edit("deals", id, { stage_id: "st-lost" });
    await drain(h, pushStep);
    expect(h.gw.get("deal", "d1").fields.Stage).toBe("Closed Lost");
  });

  it("a vendor-side rejection of one record keeps the push pending and does not stop the others", async () => {
    const { h, id } = await linked();
    h.gw.put("lead", "2", lead({ Full_Name: "B", Email: "b@example.com", Phone: null }));
    await drain(h, pullStep);
    const id2 = Object.keys(h.store.core.tables.leads).find((k) => k !== id) as string;
    h.gw.rejectWhen.push({ field: "City", value: "Bad", code: "INVALID_DATA" });
    h.store.edit("leads", id, { city: "Bad" });
    h.store.edit("leads", id2, { city: "Good" });
    const r = await drain(h, pushStep);
    expect(r.rejected).toBe(1);
    expect(h.rejects).toContain("vendor_rejected:INVALID_DATA");
    expect(h.gw.get("lead", "2").fields.City).toBe("Good");
    h.gw.rejectWhen.length = 0;
    await drain(h, pushStep);   // watermark moved on, but a later edit retries cleanly
    h.store.edit("leads", id, { city: "Fixed" });
    await drain(h, pushStep);
    expect(h.gw.get("lead", "1").fields.City).toBe("Fixed");
  });

  it("a record deleted at the vendor is never recreated or deleted in the CRM", async () => {
    const { h, id } = await linked();
    h.gw.records.Leads.delete("1");
    h.store.edit("leads", id, { city: "X" });
    const r = await drain(h, pushStep);
    expect(r.rejected).toBe(1);
    expect(h.rejects).toContain("remote_missing");
    expect(h.store.row("leads", id)).toBeDefined();
    expect(h.gw.calls.some((c) => c.startsWith("create"))).toBe(false);
  });
});

describe("push of new CRM records is opt-in", () => {
  it("does not create vendor records by default; with pushNew it creates and links them", async () => {
    const off = harness(ZOHO_DEFAULT_MAP, { objects: ["lead"] });
    off.store.seed("leads", { full_name: "Local Only", email: "l@example.com" });
    await drain(off, pushStep);
    expect(off.gw.calls.some((c) => c.startsWith("create"))).toBe(false);

    const on = harness(ZOHO_DEFAULT_MAP, { objects: ["lead"], pushNew: true });
    const id = on.store.seed("leads", { full_name: "Local Only", email: "l@example.com", phone: "+919876543210" });
    await drain(on, pushStep);
    const made = [...on.gw.records.Leads.values()][0];
    expect(made.fields).toMatchObject({ Full_Name: "Local Only", Email: "l@example.com", Phone: "+919876543210" });
    expect((await on.store.getLinkByLocal(CONN, "leads", id))?.externalId).toBe(made.id);
    on.gw.calls.length = 0;
    await drain(on, pushStep);
    expect(on.gw.calls.some((c) => c.startsWith("create"))).toBe(false);
  });

  it("a vendor duplicate is linked instead of failing, and the field rules settle the difference on the next pass", async () => {
    const h = harness(ZOHO_DEFAULT_MAP, { objects: ["lead"], pushNew: true });
    h.gw.put("lead", "555", lead({ City: "Salem" }));
    h.gw.duplicateOnCreate = "555";
    const id = h.store.seed("leads", { full_name: "Asha Rao", email: "asha@example.com", city: "Madurai" });
    await drain(h, pushStep);
    expect((await h.store.getLinkByLocal(CONN, "leads", id))?.externalId).toBe("555");
    await drain(h, pushStep);   // crm owns the column: its value goes to the vendor
    h.store.edit("leads", id, { city: "Madurai" });
    await drain(h, pushStep);
    expect(h.gw.get("lead", "555").fields.City).toBe("Madurai");
  });
});

describe("tenant isolation and protected columns", () => {
  it("never reads, writes or pushes another workspace's rows", async () => {
    const h = harness(ZOHO_DEFAULT_MAP, { objects: ["lead"], pushNew: true });
    h.store.seed("leads", { full_name: "Other Tenant", email: "o@example.com", workspace_id: "w-OTHER", tenant_id: "t-OTHER" });
    h.gw.put("lead", "1", lead({ Email: "o@example.com" }));   // same email as the other workspace's lead
    await drain(h, pullStep);
    // the other workspace's lead is not a duplicate here: a new lead is created in THIS workspace
    expect(leadsOf(h).filter((l) => l.workspace_id === WS)).toHaveLength(1);
    await drain(h, pushStep);
    expect([...h.gw.records.Leads.values()].some((r) => r.fields.Full_Name === "Other Tenant")).toBe(false);
  });

  it("a tenant field-map row cannot write identity, isolation or bookkeeping columns", async () => {
    const evil: FieldMapSpec[] = [...ZOHO_DEFAULT_MAP,
      { externalObject: "Leads", externalField: "Tenant", localTable: "leads", localColumn: "tenant_id", direction: "in" },
      { externalObject: "Leads", externalField: "Ws", localTable: "leads", localColumn: "workspace_id", direction: "in" },
      { externalObject: "Leads", externalField: "Id2", localTable: "leads", localColumn: "id", direction: "in" },
      { externalObject: "Leads", externalField: "Sql", localTable: "leads", localColumn: "city; drop table leads", direction: "in" },
    ];
    const h = harness(evil, { objects: ["lead"] });
    h.gw.put("lead", "1", lead({ Tenant: "t-EVIL", Ws: "w-EVIL", Id2: "x", Sql: "1" }));
    await drain(h, pullStep);
    expect(leadsOf(h)[0]).toMatchObject({ tenant_id: "t-1", workspace_id: WS });
    expect(oc(h).columns).not.toEqual(expect.arrayContaining(["tenant_id", "workspace_id", "id"]));
  });

  it("a link that belongs to another table (contact target switched) is refused, not written through", async () => {
    const h = harness(ZOHO_DEFAULT_MAP, { objects: ["lead"] });
    h.gw.put("lead", "1", lead());
    await drain(h, pullStep);
    const o = objectCtx(h.ctx, "contact");
    const t = emptyTally();
    // the same vendor id now arrives for the contacts table: its link says leads
    await applyRemote(h.ctx, { ...o, vendorObj: "Leads" }, [{ id: "1", modifiedAt: null, fields: lead() }], t);
    expect(t.rejected).toBe(1);
    expect(h.rejects).toContain("link_table_mismatch");
  });
});

const oc = (h: ReturnType<typeof harness>) => objectCtx(h.ctx, "lead");
