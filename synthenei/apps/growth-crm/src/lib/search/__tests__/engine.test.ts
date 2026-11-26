import { describe, expect, it } from "vitest";
import { systemPrincipal } from "@/lib/authz";
import type { Db } from "@/lib/db/client";
import type { FieldDef, ObjectTypeDef } from "@/lib/metadata/types";
import { searchReal, searchableKeys, searchableTypes, type ObjectSearchDef, type RealDeps } from "../engine";
import type { Role } from "@/lib/data/types";

type Call = { table: string; select: string; eq: [string, unknown][]; is: [string, unknown][]; or: string[]; limit?: number };
/** A fake PostgREST builder: records every call and answers with rows per table (or an error for one table). */
function fakeDb(rows: Record<string, Record<string, unknown>[]>, failTable?: string) {
  const calls: Call[] = [];
  const db = { from(table: string) {
    const c: Call = { table, select: "", eq: [], is: [], or: [] };
    calls.push(c);
    const b: Record<string, unknown> = {};
    const chain = (f: (...a: never[]) => void) => (...a: unknown[]) => { (f as (...x: unknown[]) => void)(...a); return b; };
    b.select = chain(((s: string) => { c.select = s; }) as never);
    b.eq = chain(((k: string, v: unknown) => { c.eq.push([k, v]); }) as never);
    b.is = chain(((k: string, v: unknown) => { c.is.push([k, v]); }) as never);
    b.or = chain(((f: string) => { c.or.push(f); }) as never);
    b.limit = (n: number) => { c.limit = n; return Promise.resolve(table === failTable ? { data: null, error: { message: "boom" } } : { data: rows[table] ?? [], error: null }); };
    return b;
  } } as unknown as Db;
  return { db, calls };
}

const field = (key: string, o: Partial<FieldDef> = {}): FieldDef => ({
  id: key, objectTypeId: "ot1", key, label: { en: key }, type: "text", options: {}, required: false, uniqueInWorkspace: false, isPii: false, isSearchable: true, isFilterable: false,
  default: null, validation: {}, section: null, position: 0, editablePerm: null, archivedAt: null, ...o,
} as FieldDef);
const object: ObjectTypeDef = { id: "ot1", key: "x_assets", kind: "custom", label: { en: { one: "Asset", many: "Assets" } }, icon: "box", primaryField: "name", isEnabled: true, schemaVersion: 1 };
const asset = (fields: FieldDef[], o: Partial<ObjectTypeDef> = {}): ObjectSearchDef => ({ object: { ...object, ...o }, fields });

/** System roles carry no obj:<key> grants in the fixture (they come from the database), so object tests add the read grant. */
const deps = (role: Role, db: Db, objects: ObjectSearchDef[] = [], extra: Partial<Parameters<typeof systemPrincipal>[0]> = {}): RealDeps => {
  const p = systemPrincipal({ uid: "u", workspaceId: "ws-key", role, ...extra });
  for (const o of objects) p.grants[`obj:${o.object.key}.read`] = { scope: "all" };
  return { db: async () => db, principal: p, ws: { uuid: "ws-uuid", id: "ws-key" }, objects };
};

describe("searchableKeys", () => {
  it("only live, searchable, text-like fields; PII only with pii.read; unsafe keys never", () => {
    const o = asset([field("name"), field("notes", { type: "long_text" }), field("phone", { type: "phone", isPii: true }), field("qty", { type: "number" }), field("old", { archivedAt: "2026-01-01" }), field("hidden", { isSearchable: false }), field("Bad-Key")]);
    expect(searchableKeys(o, false)).toEqual(["name", "notes"]);
    expect(searchableKeys(o, true)).toEqual(["name", "notes", "phone"]);
  });
});

describe("searchReal: permissions and masking", () => {
  it("a viewer queries the masked views, never the base tables, and only masked columns", async () => {
    const { db, calls } = fakeDb({ v_leads_masked: [{ id: "l1", display_name: "K. R.", firm_name: "Vaigai" }], v_contacts_masked: [] });
    const r = await searchReal(deps("viewer", db), "kar", "en");
    const tables = calls.map((c) => c.table);
    expect(tables).toContain("v_leads_masked"); expect(tables).not.toContain("leads"); expect(tables).not.toContain("contacts");
    const lead = calls.find((c) => c.table === "v_leads_masked")!;
    expect(lead.or[0]).not.toContain("full_name"); expect(lead.select).not.toMatch(/full_name|email|phone/);
    expect(r.hits.find((h) => h.type === "lead")).toMatchObject({ title: "K. R.", masked: true });
  });
  it("an owner reads the base tables, scoped to the workspace uuid and live rows", async () => {
    const { db, calls } = fakeDb({ leads: [{ id: "l1", full_name: "Karthik Raja", firm_name: "Vaigai", role_title: "Partner" }] });
    const r = await searchReal(deps("owner", db), "kar", "en");
    const c = calls.find((x) => x.table === "leads")!;
    expect(c.eq).toContainEqual(["workspace_id", "ws-uuid"]); expect(c.is).toContainEqual(["deleted_at", null]);
    expect(c.or[0]).toBe("full_name.ilike.*kar*,firm_name.ilike.*kar*,role_title.ilike.*kar*");
    expect(r.hits.find((h) => h.type === "lead")).toMatchObject({ title: "Karthik Raja", href: "/leads/l1" });
    expect(r.hits.find((h) => h.type === "lead")?.masked).toBe(false);
  });
  it("marketing (no accounts or leads module) and module-off types are not queried", async () => {
    const { db, calls } = fakeDb({});
    await searchReal(deps("owner", db, [], { modulesOff: ["accounts"] }), "kar", "en");
    expect(calls.map((c) => c.table)).not.toContain("accounts");
  });
  it("a rep's own-scope grant drops rows owned by someone else even if the database returned them", async () => {
    const { db } = fakeDb((() => {
      const both = [{ id: "mine", owner_id: "u" }, { id: "theirs", owner_id: "someone-else" }];
      return { leads: both.map((x) => ({ ...x, full_name: "A One" })), v_leads_masked: both.map((x) => ({ ...x, display_name: "A. O." })) };
    })());
    const r = await searchReal(deps("sales_rep", db), "a o", "en");
    expect(r.hits.filter((h) => h.type === "lead").map((h) => h.key)).toEqual(["lead:mine"]);
  });
  it("support read-only sessions can still search (reads are allowed)", async () => {
    const { db } = fakeDb({ accounts: [{ id: "a1", name: "Vaigai" }] });
    const r = await searchReal(deps("owner", db, [], { support: { mode: "read_only" } }), "vai", "en");
    expect(r.hits.some((h) => h.type === "account")).toBe(true);
  });
  it("one failing source marks the result partial and keeps the others", async () => {
    const { db } = fakeDb({ accounts: [{ id: "a1", name: "Vaigai" }] }, "leads");
    const r = await searchReal(deps("owner", db), "vai", "en");
    expect(r.partial).toBe(true); expect(r.hits.map((h) => h.type)).toContain("account");
  });
});

describe("searchReal: tasks, deals and campaigns", () => {
  const rows = {
    tasks: [{ id: "t1", title: "Call Kovai Steels", status: "open", assignee_id: "u" }],
    deals: [{ id: "d1", name: "Kovai Steels - 12 seats", next_step: "Send quote", owner_id: "u" }],
    campaigns: [{ id: "c1", name: "Kovai launch", status: "active", owner_id: "u" }],
  };
  it("owner finds a task, a deal and a campaign through the session client, scoped to the workspace", async () => {
    const { db, calls } = fakeDb(rows);
    const r = await searchReal(deps("owner", db), "kov", "en");
    expect(r.hits.find((h) => h.type === "task")).toMatchObject({ key: "task:t1", href: "/tasks" });
    expect(r.hits.find((h) => h.type === "deal")).toMatchObject({ key: "deal:d1", href: "/pipeline", subtitle: "Send quote" });
    expect(r.hits.find((h) => h.type === "campaign")).toMatchObject({ key: "campaign:c1", href: "/campaigns/c1" });
    for (const t of ["tasks", "deals", "campaigns"]) expect(calls.find((c) => c.table === t)!.eq).toContainEqual(["workspace_id", "ws-uuid"]);
    expect(calls.find((c) => c.table === "deals")!.is).toContainEqual(["deleted_at", null]);
    expect(calls.find((c) => c.table === "tasks")!.or[0]).toBe("title.ilike.*kov*");
  });
  it("a principal without tasks.read, deals.read or campaigns.read never queries those tables", async () => {
    const { db, calls } = fakeDb(rows);
    const d = deps("owner", db);
    const grants = { ...d.principal.grants }; // copy: the role catalog grants object is shared between principals
    for (const k of ["tasks.read", "deals.read", "campaigns.read"]) delete grants[k];
    d.principal = { ...d.principal, grants };
    expect(searchableTypes(d.principal, []).types).not.toContain("task");
    const r = await searchReal(d, "kov", "en");
    for (const t of ["tasks", "deals", "campaigns"]) expect(calls.map((c) => c.table)).not.toContain(t);
    expect(r.hits.some((h) => ["task", "deal", "campaign"].includes(h.type))).toBe(false);
  });
  it("own-scope grants drop other people's rows even if returned", async () => {
    const { db } = fakeDb({ tasks: [{ id: "a", title: "x1", assignee_id: "u" }, { id: "b", title: "x2", assignee_id: "other" }], deals: [{ id: "a", name: "d1", owner_id: "u" }, { id: "b", name: "d2", owner_id: "other" }] });
    const d = deps("owner", db);
    d.principal = { ...d.principal, grants: { ...d.principal.grants, "tasks.read": { scope: "own" }, "deals.read": { scope: "own" } } };
    const r = await searchReal(d, "xx", "en");
    expect(r.hits.filter((h) => h.type === "task").map((h) => h.key)).toEqual(["task:a"]);
    expect(r.hits.filter((h) => h.type === "deal").map((h) => h.key)).toEqual(["deal:a"]);
  });
  it("a failing campaigns source is partial, others stay", async () => {
    const { db } = fakeDb(rows, "campaigns");
    const r = await searchReal(deps("owner", db), "kov", "en");
    expect(r.partial).toBe(true); expect(r.hits.some((h) => h.type === "task")).toBe(true);
  });
});

describe("searchReal: custom objects", () => {
  const rec = { id: "r1", title: "Pump 7", owner_id: null };
  it("searches the title and searchable text fields of readable objects", async () => {
    const { db, calls } = fakeDb({ records: [rec] });
    const r = await searchReal(deps("owner", db, [asset([field("name"), field("serial")])]), "pump", "en");
    const c = calls.find((x) => x.table === "records")!;
    expect(c.eq).toContainEqual(["object_type_id", "ot1"]); expect(c.eq).toContainEqual(["workspace_id", "ws-uuid"]);
    expect(c.or[0]).toBe("title.ilike.*pump*,data->>name.ilike.*pump*,data->>serial.ilike.*pump*");
    expect(r.hits.find((h) => h.type === "record")).toMatchObject({ href: "/o/x_assets/r1", subtitle: "Asset", objectKey: "x_assets" });
  });
  it("uses the Tamil object label when the viewer language is Tamil", async () => {
    const { db } = fakeDb({ records: [rec] });
    const r = await searchReal(deps("owner", db, [asset([field("name")], { label: { en: { one: "Asset", many: "Assets" }, ta: { one: "சொத்து", many: "சொத்துகள்" } } })]), "pump", "ta");
    expect(r.hits.find((h) => h.type === "record")?.subtitle).toBe("சொத்து");
  });
  it("without pii.read the PII field is not searched and a PII primary field gives a masked title", async () => {
    const o = asset([field("name", { isPii: true }), field("serial"), field("phone", { type: "phone", isPii: true })]);
    const { db, calls } = fakeDb({ records: [rec] });
    const d = deps("owner", db, [o]);
    const { pii, ...rest } = { pii: d.principal.grants["pii.read"], ...d.principal.grants };
    void pii; delete (rest as Record<string, unknown>)["pii.read"];
    const r = await searchReal({ ...d, principal: { ...d.principal, grants: rest as typeof d.principal.grants } }, "pump", "en");
    const c = calls.find((x) => x.table === "records")!;
    expect(c.or[0]).toBe("data->>serial.ilike.*pump*");
    expect(r.hits.find((h) => h.type === "record")).toMatchObject({ title: "••••", masked: true });
  });
  it("an object the viewer cannot read is skipped", () => {
    const p = systemPrincipal({ uid: "u", workspaceId: "ws-key", role: "viewer" });
    expect(searchableTypes(p, [asset([field("name")])]).objects).toEqual([]);
  });
});
