// Demo workspaces never touch Supabase. They get ONE labelled example custom object so the list, detail, nav entry, saved
// views and layouts can be shown. Nothing here is a tenant, brand, price or URL: it is generic sample data, tagged Example.
// Demo grants mirror what the DB gives a new custom object (owner full, sales manager read+write) plus read for sales reps,
// so the permission difference between roles is visible.
import type { LayoutRow } from "@/lib/layouts/resolve";
import type { FieldDef, ObjectTypeDef } from "@/lib/metadata/types";
import type { Role } from "@/lib/data/types";
import type { LinkRow, ObjectRecord, SavedView } from "./types";

export const DEMO_OBJECT_KEY = "example_items";
export const DEMO_TAG = "Example";
const OT_ID = `demo-ot-${DEMO_OBJECT_KEY}`;

export const demoObject = (): ObjectTypeDef => ({
  id: OT_ID, key: DEMO_OBJECT_KEY, kind: "custom",
  label: { en: { one: "Example item", many: "Example items" }, ta: { one: "எடுத்துக்காட்டு உருப்படி", many: "எடுத்துக்காட்டு உருப்படிகள்" } },
  icon: "box", primaryField: "name", isEnabled: true, schemaVersion: 1,
});

const f = (i: number, p: Partial<FieldDef> & Pick<FieldDef, "key" | "label" | "type">): FieldDef => ({
  id: `demo-${DEMO_OBJECT_KEY}-${p.key}`, objectTypeId: OT_ID, options: {}, required: false, uniqueInWorkspace: false, isPii: false, isSearchable: false,
  isFilterable: true, default: null, validation: {}, section: null, position: i, editablePerm: null, archivedAt: null, ...p,
});

export const demoFields = (): FieldDef[] => [
  f(0, { key: "name", label: { en: "Name", ta: "பெயர்" }, type: "text", required: true, isSearchable: true }),
  f(1, { key: "status", label: { en: "Status", ta: "நிலை" }, type: "select", section: "Details", default: "new",
    options: { choices: [{ key: "new", label: { en: "New", ta: "புதியது" }, color: "info" }, { key: "active", label: { en: "Active", ta: "செயலில்" }, color: "success" }, { key: "done", label: { en: "Done", ta: "முடிந்தது" }, color: "neutral" }] } }),
  f(2, { key: "quantity", label: { en: "Quantity", ta: "அளவு" }, type: "number", section: "Details" }),
  f(3, { key: "due_on", label: { en: "Due date", ta: "முடிவு தேதி" }, type: "date", section: "Details" }),
  f(4, { key: "contact_phone", label: { en: "Contact phone", ta: "தொடர்பு தொலைபேசி" }, type: "phone", section: "Contact", isPii: true }),
  f(5, { key: "notes", label: { en: "Notes", ta: "குறிப்புகள்" }, type: "long_text", section: "Notes", isFilterable: false }),
];

export const demoRecords = (): ObjectRecord[] => [
  { id: "demo-rec-1", title: "Example: first item", data: { name: "Example: first item", status: "active", quantity: 12, due_on: "2026-12-05", contact_phone: "+919800000001", notes: "Sample record. Nothing here is real." }, ownerId: null, version: 1, createdAt: "2026-10-01T05:00:00Z", updatedAt: "2026-10-20T05:00:00Z" },
  { id: "demo-rec-2", title: "Example: second item", data: { name: "Example: second item", status: "new", quantity: 3, due_on: "2026-12-18", contact_phone: "+919800000002" }, ownerId: null, version: 1, createdAt: "2026-10-02T05:00:00Z", updatedAt: "2026-10-18T05:00:00Z" },
  { id: "demo-rec-3", title: "Example: third item", data: { name: "Example: third item", status: "done", quantity: 40 }, ownerId: null, version: 1, createdAt: "2026-10-03T05:00:00Z", updatedAt: "2026-10-12T05:00:00Z" },
  { id: "demo-rec-4", title: "Example: fourth item", data: { name: "Example: fourth item", status: "active", quantity: 7, due_on: "2026-11-30" }, ownerId: null, version: 1, createdAt: "2026-10-04T05:00:00Z", updatedAt: "2026-10-10T05:00:00Z" },
];

export const demoLinks = (): LinkRow[] => [{ id: "demo-link-1", fromType: `obj:${DEMO_OBJECT_KEY}`, fromId: "demo-rec-1", toType: `obj:${DEMO_OBJECT_KEY}`, toId: "demo-rec-2", relation: "related" }];

/** Role-specific layout shown to sales reps in the demo: a reduced summary with no related list. Role ids are role keys in demo. */
export const demoLayouts = (): LayoutRow[] => [
  { id: "demo-layout-rep", objectTypeId: OT_ID, kind: "detail", workspaceId: null, roleId: "sales_rep", version: 1,
    spec: { sections: [{ id: "s1", title: "Summary", fields: ["status", "quantity"] }], showRelated: false, showComments: true } },
];

export const demoViews = (): SavedView[] => [
  { id: "demo-view-active", objectTypeId: OT_ID, ownerId: null, name: "Active items", filters: { "custom.status": { op: "eq", value: "active" } }, sort: [{ id: "custom.quantity", desc: true }], columns: ["title", "custom.status", "custom.quantity"], visibility: "workspace", position: 0 },
];

/** What the database trigger grants a new custom object by role (owner: all; sales manager: read+write), plus read for reps. */
const DEMO_GRANTS: Partial<Record<Role, { read: boolean; write: boolean; delete: boolean }>> = {
  owner: { read: true, write: true, delete: true }, sales_manager: { read: true, write: true, delete: false }, sales_rep: { read: true, write: false, delete: false },
};
export const demoAccess = (role: Role) => DEMO_GRANTS[role] ?? { read: false, write: false, delete: false };
