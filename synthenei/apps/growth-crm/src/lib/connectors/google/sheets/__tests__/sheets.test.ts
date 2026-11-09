// Google Sheets import: spreadsheet link / range validation, cell matrix -> ParsedSheet, mapping (saved, field map, auto), planning and
// dedupe through the T034 planner, writes through a fake port, the due-rule of the stream (one-time nonce + scheduled re-sync),
// the Sheets API client, and preview / start with tenant isolation and audit.
import { beforeEach, describe, expect, it } from "vitest";
import type { WriteResult } from "@/lib/import/engine";
import { emptyIndex, type ExistingIndex, type PlannedRow, type TargetField } from "@/lib/import/types";
import { targetsFor } from "@/lib/import/targets";
import { BASE } from "@/i18n/registry";
import type { RuntimeDeps } from "../../../core/ports";
import { CredentialError, type ConnectionRow, type FieldMapSpec } from "../../../core/types";
import { makeSheetsApi } from "../api";
import { sheetsGatewayFor } from "../config";
import { CONFIG_KEY } from "../constants";
import { runSheetImport, type SheetsImportPort } from "../import";
import { makeMockSheets } from "../mock";
import { listSheetTabs, previewSheet, startSheetImport } from "../select";
import { hasMapping, isValidRange, mappingFromFieldMap, matrixToSheet, parseSheetConfig, parseSpreadsheetId, serializeSheetConfig, type SheetConfig } from "../source";
import { isDue, sheetsStep, type SheetsDeps, type SheetsStreamCtx } from "../sync";

const labels = (BASE.en.imports as { fields: Record<string, string> }).fields;
const LEAD_TARGETS: TargetField[] = targetsFor("lead", (k) => labels[k] ?? k);
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

describe("parseSpreadsheetId / isValidRange", () => {
  it("takes a bare id or a docs link, nothing else", () => {
    expect(parseSpreadsheetId(SHEET_ID)).toBe(SHEET_ID);
    expect(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`)).toBe(SHEET_ID);
    expect(parseSpreadsheetId(`https://docs.google.com/spreadsheets/u/1/d/${SHEET_ID}/edit`)).toBe(SHEET_ID);
    expect(parseSpreadsheetId("https://evil.invalid/spreadsheets/d/abc")).toBeNull();
    expect(parseSpreadsheetId("short")).toBeNull();
    expect(parseSpreadsheetId("../../etc/passwd")).toBeNull();
    expect(parseSpreadsheetId("")).toBeNull();
  });
  it("accepts A1 ranges with an optional tab, rejects path tricks", () => {
    for (const r of ["A1:F500", "A:F", "Sheet1!A1:F500", "'My leads'!A1:F500", "A1"]) expect(isValidRange(r), r).toBe(true);
    for (const r of ["", "A1:F500/../x", "Sheet1!!A1", "'a'b'!A1", "A1:F500?x=1", "1:2", "https://x"]) expect(isValidRange(r), r).toBe(false);
  });
});

describe("matrixToSheet", () => {
  it("uses the first non-blank row as headers, pads ragged rows, numbers rows like the CSV importer", () => {
    const s = matrixToSheet([[], ["Name", "Email", "City"], ["Asha", "asha@example.com"], ["", "", ""], ["Ravi", "ravi@example.com", "Madurai"]]);
    expect(s.headers).toEqual(["Name", "Email", "City"]);
    expect(s.rows).toEqual([{ rowNo: 2, cells: { Name: "Asha", Email: "asha@example.com", City: "" } }, { rowNo: 4, cells: { Name: "Ravi", Email: "ravi@example.com", City: "Madurai" } }]);
    expect(s.blankRows).toBe(1);
  });
  it("de-duplicates and fills header names; refuses empty and oversize input", () => {
    expect(matrixToSheet([["Phone", "Phone", ""], ["1", "2", "3"]]).headers).toEqual(["Phone", "Phone (2)", "Column 3"]);
    expect(() => matrixToSheet([["Name"]])).toThrow(/empty/);
    expect(() => matrixToSheet([[], []])).toThrow(/empty/);
    expect(() => matrixToSheet([["N"], ["a"], ["b"], ["c"]], 2)).toThrow(/too_many_rows/);
    expect(() => matrixToSheet([Array.from({ length: 61 }, (_, i) => `c${i}`), ["x"]])).toThrow(/too_many_columns/);
  });
});

describe("mapping", () => {
  const spec = (h: string, col: string, over: Partial<FieldMapSpec> = {}): FieldMapSpec => ({ externalObject: "Row", externalField: h, localTable: "leads", localColumn: col, direction: "in", ...over });
  it("reads the field-mapping editor rows for object Row and the import object's table, headers case-insensitively", () => {
    const m = mappingFromFieldMap([spec("full name", "full_name"), spec("MOBILE", "phone"), spec("Email", "email", { localTable: "contacts" }), spec("City", "city", { externalObject: "Lead" }), spec("Source", "source", { direction: "out" })], "lead", ["Full Name", "Mobile", "Email", "City", "Source"]);
    expect(m).toEqual({ "Full Name": "full_name", Mobile: "phone", Email: "", City: "", Source: "" });
    expect(hasMapping(m)).toBe(true);
    expect(hasMapping({ A: "" })).toBe(false);
  });
  it("saved configuration round-trips and bad configuration is dropped", () => {
    const cfg: SheetConfig = { spreadsheetId: SHEET_ID, range: "'Leads'!A1:F10", object: "lead", mode: "merge", mapping: { Name: "full_name" }, resync: true, nonce: "n1" };
    expect(parseSheetConfig(serializeSheetConfig(cfg))).toEqual(cfg);
    for (const bad of [undefined, "", "not json", "null", JSON.stringify({ ...cfg, range: "A1/../x" }), JSON.stringify({ ...cfg, object: "deal" }), JSON.stringify({ ...cfg, mode: "overwrite" }), JSON.stringify({ ...cfg, nonce: "" }), JSON.stringify({ ...cfg, spreadsheetId: "x" })]) expect(parseSheetConfig(bad), String(bad)).toBeNull();
  });
});

class FakePort implements SheetsImportPort {
  stored: { id: string; email?: string; phone?: string; full_name?: string; ws: string; synthetic?: boolean }[] = [];
  writes: { mode: string; source: string; ws: string; tenant: string; n: number }[] = [];
  failEmail: string | null = null;
  n = 0;
  async targets() { return LEAD_TARGETS; }
  async loadExisting(ws: string): Promise<ExistingIndex> {
    const idx = emptyIndex();
    for (const r of this.stored.filter((x) => x.ws === ws)) { if (r.email) idx.byEmail.set(r.email, r.id); if (r.phone) idx.byPhone.set(r.phone, r.id); }
    return idx;
  }
  async write(rows: PlannedRow[], o: { workspaceId: string; tenantId: string; mode: "skip" | "merge"; source: string }): Promise<WriteResult> {
    const res: WriteResult = { created: 0, merged: 0, skipped: 0, failed: [] };
    for (const p of rows) {
      if (p.status === "new") {
        if (this.failEmail && p.record.email === this.failEmail) { res.failed.push({ rowNo: p.rowNo, reason: "write_failed" }); continue; }
        this.stored.push({ id: `l-${++this.n}`, email: p.record.email as string | undefined, phone: p.record.phone as string | undefined, full_name: p.record.full_name as string, ws: o.workspaceId, synthetic: p.record.is_synthetic === true }); res.created++;
      } else if (p.status === "duplicate") { if (o.mode === "merge" && p.dupId) res.merged++; else res.skipped++; }
    }
    this.writes.push({ mode: o.mode, source: o.source, ws: o.workspaceId, tenant: o.tenantId, n: rows.length });
    return res;
  }
}
const CONN: ConnectionRow = { id: "c-1", tenantId: "t-1", workspaceId: "w-1", connectorId: "google-sheets", mode: "live", status: "connected", settings: {}, credentialSecretId: "sec-1", webhookSecretId: null, tokenExpiresAt: null };
const CFG: SheetConfig = { spreadsheetId: SHEET_ID, range: "A1:F100", object: "lead", mode: "skip", mapping: {}, resync: false, nonce: "n1" };
let port: FakePort;
beforeEach(() => { port = new FakePort(); });

describe("runSheetImport", () => {
  const live = (values: string[][]) => ({ ...makeMockSheets(values), kind: "api" as const });
  it("auto-maps headers, plans new / duplicate / invalid with the T034 rules, writes new rows once, source sheets", async () => {
    const r = await runSheetImport({ conn: CONN, gateway: live(makeMockValues()), port, config: CFG, fieldMap: [] });
    expect(r).toMatchObject({ ok: true, summary: { total: 5, fresh: 3, duplicates: 1, invalid: 1 }, created: 3, skipped: 1, failed: 0 });
    expect(r.rejected).toEqual({ phone_invalid: 1 });
    expect(port.writes[0]).toMatchObject({ source: "sheets", ws: "w-1", tenant: "t-1", mode: "skip" });
    expect(port.stored.map((s) => s.email)).toEqual(["person.one@example.invalid", "person.two@example.invalid", "person.three@example.invalid"]);
  });
  it("dedupes against records already in the workspace (re-sync never doubles), and merge mode updates", async () => {
    await runSheetImport({ conn: CONN, gateway: live(makeMockValues()), port, config: CFG, fieldMap: [] });
    const again = await runSheetImport({ conn: CONN, gateway: live(makeMockValues()), port, config: { ...CFG, mode: "merge" }, fieldMap: [] });
    expect(again).toMatchObject({ created: 0, merged: 4, summary: { fresh: 0, duplicates: 4, invalid: 1 } });
    expect(port.stored).toHaveLength(3);
  });
  it("tenant isolation: another workspace's identical person is not a duplicate", async () => {
    port.stored.push({ id: "other", email: "person.one@example.invalid", ws: "w-OTHER" });
    const r = await runSheetImport({ conn: CONN, gateway: live(makeMockValues()), port, config: CFG, fieldMap: [] });
    expect(r.created).toBe(3);
  });
  it("uses the saved mapping first, then the tenant's field map, then auto-mapping", async () => {
    const values = [["Customer", "Number", "Mail"], ["Asha", "98450 11223", "asha@example.com"]];
    const viaSaved = await runSheetImport({ conn: CONN, gateway: live(values), port, config: { ...CFG, mapping: { Customer: "full_name", Number: "phone", Mail: "email" } }, fieldMap: [] });
    expect(viaSaved).toMatchObject({ ok: true, created: 1 });
    port = new FakePort();
    const fm: FieldMapSpec[] = [{ externalObject: "Row", externalField: "customer", localTable: "leads", localColumn: "full_name", direction: "in" }, { externalObject: "Row", externalField: "mail", localTable: "leads", localColumn: "email", direction: "in" }];
    expect(await runSheetImport({ conn: CONN, gateway: live(values), port, config: CFG, fieldMap: fm })).toMatchObject({ ok: true, created: 1 });
  });
  it("an incomplete mapping, an empty range and an oversize range stop before anything is written", async () => {
    const nameless = await runSheetImport({ conn: CONN, gateway: live([["Colour"], ["red"]]), port, config: CFG, fieldMap: [] });
    expect(nameless).toMatchObject({ ok: false, reason: "mapping_incomplete" });
    expect(await runSheetImport({ conn: CONN, gateway: live([["Name", "Email"]]), port, config: CFG, fieldMap: [] })).toMatchObject({ ok: false, reason: "empty" });
    const big = [["Name", "Email"], ...Array.from({ length: 10_001 }, (_, i) => [`n${i}`, `e${i}@example.com`])];
    expect(await runSheetImport({ conn: CONN, gateway: live(big), port, config: CFG, fieldMap: [] })).toMatchObject({ ok: false, reason: "too_many_rows" });
    expect(port.writes).toHaveLength(0);
  });
  it("counts write failures as rejected rows without dropping their neighbours", async () => {
    port.failEmail = "person.two@example.invalid";
    const r = await runSheetImport({ conn: CONN, gateway: live(makeMockValues()), port, config: CFG, fieldMap: [] });
    expect(r).toMatchObject({ created: 2, failed: 1 });
    expect(r.rejected.write_failed).toBe(1);
  });
  it("Showcase: sample rows are flagged synthetic and duplicates are never merged", async () => {
    const r = await runSheetImport({ conn: CONN, gateway: makeMockSheets(), port, config: { ...CFG, mode: "merge" }, fieldMap: [] });
    expect(r.created).toBe(3);
    expect(port.stored.every((s) => s.synthetic)).toBe(true);
    expect(port.writes[0].mode).toBe("skip");
  });
  it("dry run writes nothing", async () => {
    expect(await runSheetImport({ conn: CONN, gateway: live(makeMockValues()), port, config: CFG, fieldMap: [], dryRun: true })).toMatchObject({ ok: true, created: 0, summary: { fresh: 3 } });
    expect(port.writes).toHaveLength(0);
  });
});
function makeMockValues(): string[][] {
  return [
    ["Name", "Mobile", "Email", "Company", "City", "Source"],
    ["Sample Person One", "+91 90000 10001", "person.one@example.invalid", "Sample Co One", "Sample City", "Website"],
    ["Sample Person Two", "+91 90000 10002", "person.two@example.invalid", "Sample Co Two", "Sample City", "Referral"],
    ["Sample Person Three", "", "person.three@example.invalid", "Sample Co Three", "Other City", "Event"],
    ["Sample Person One", "+91 90000 10001", "person.one@example.invalid", "Sample Co One", "Sample City", "Website"],
    ["Sample Person Four", "12345", "not-an-email", "Sample Co Four", "Other City", "Website"],
  ];
}

describe("sheets stream (one-time import and scheduled re-sync)", () => {
  const NOW = new Date("2026-11-09T05:00:00Z");   // 10:30 IST on the 9th
  const deps = (now = NOW): SheetsDeps => ({ port, fieldMap: async () => [], log: { info() {}, warn() {}, error() {} }, now: () => now });
  const ctx = (cfg: SheetConfig | null, over: Partial<SheetsStreamCtx> = {}, now = NOW): SheetsStreamCtx => ({
    deps: deps(now), conn: CONN, secrets: cfg ? { access_token: "t", [CONFIG_KEY]: serializeSheetConfig(cfg) } : { access_token: "t" },
    gateway: { ...makeMockSheets(makeMockValues()), kind: "api" } as unknown as SheetsStreamCtx["gateway"], fieldMap: [], reject: () => {}, ...over,
  });
  it("does nothing without a saved sheet", async () => { expect(await sheetsStep(ctx(null), undefined)).toMatchObject({ sample: { skipped: "no_sheet" }, rowsIn: 0 }); });
  it("one-time: runs when the nonce is new, then not again for the same nonce", async () => {
    const first = await sheetsStep(ctx(CFG), undefined);
    expect(first).toMatchObject({ rowsIn: 3, rowsRejected: 1, cursor: { nonce: "n1", day: "2026-11-09" } });
    expect(await sheetsStep(ctx(CFG), first.cursor)).toMatchObject({ sample: { skipped: "not_due" }, rowsIn: 0 });
    expect(port.stored).toHaveLength(3);
  });
  it("a new nonce (Import now again) runs again; duplicates are skipped, not doubled", async () => {
    const first = await sheetsStep(ctx(CFG), undefined);
    const again = await sheetsStep(ctx({ ...CFG, nonce: "n2" }), first.cursor);
    expect(again).toMatchObject({ rowsIn: 0, sample: { created: 0, duplicates: 4 } });
    expect(port.stored).toHaveLength(3);
  });
  it("scheduled re-sync: due once per IST day, only when enabled", async () => {
    const cfg = { ...CFG, resync: true };
    const done = { nonce: "n1", day: "2026-11-09" };
    expect(isDue(done, cfg, NOW)).toBe(false);
    expect(isDue({ nonce: "n1", day: "2026-11-08" }, cfg, NOW)).toBe(true);
    expect(isDue({ nonce: "n1", day: "2026-11-08" }, { ...cfg, resync: false }, NOW)).toBe(false);
    expect(isDue({}, cfg, NOW)).toBe(true);
    // 18:30 UTC rolls the IST day over
    expect(isDue(done, cfg, new Date("2026-11-09T18:31:00Z"))).toBe(true);
  });
  it("a configuration problem is recorded and not retried every scan: partial run with the reason, cursor advanced", async () => {
    const reasons: string[] = [];
    const r = await sheetsStep(ctx(CFG, { gateway: { ...makeMockSheets([["Colour"], ["red"]]), kind: "api" } as unknown as SheetsStreamCtx["gateway"], reject: (x) => reasons.push(x) }), undefined);
    expect(r).toMatchObject({ rowsRejected: 1, done: true, cursor: { nonce: "n1" }, sample: { failed: "mapping_incomplete" } });
    expect(reasons).toEqual(["mapping_incomplete"]);
    expect(port.writes).toHaveLength(0);
  });
});

describe("Sheets API client", () => {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  it("reads tabs with a fields mask and stringifies cell values", async () => {
    const urls: string[] = [];
    const queue = [json({ properties: { title: "Leads" }, sheets: [{ properties: { title: "Tab 1", gridProperties: { rowCount: 100, columnCount: 6 } } }, { properties: {} }] }), json({ range: "Tab 1!A1:B2", values: [["Name", 7], ["A", null, "x"]] })];
    const f = (async (u: string) => { urls.push(u); return queue.shift()!; }) as unknown as typeof fetch;
    const g = makeSheetsApi({ base: "https://sheets.invalid/v4", token: "t", fetch: f });
    expect(await g.info(SHEET_ID)).toEqual({ title: "Leads", tabs: [{ title: "Tab 1", rows: 100, cols: 6 }] });
    expect(urls[0]).toContain(`https://sheets.invalid/v4/spreadsheets/${SHEET_ID}?fields=`);
    expect(await g.readRange(SHEET_ID, "'Tab 1'!A1:B2")).toEqual([["Name", "7"], ["A", "", "x"]]);
    expect(urls[1]).toContain(`/values/${encodeURIComponent("'Tab 1'!A1:B2")}?`);
    expect(urls[1]).toContain("valueRenderOption=FORMATTED_VALUE");
  });
  it("an empty range has no values key; ids and ranges are validated; an unreadable sheet needs the owner", async () => {
    const g = makeSheetsApi({ base: "https://sheets.invalid/v4", token: "t", fetch: (async () => json({})) as unknown as typeof fetch });
    expect(await g.readRange(SHEET_ID, "A1:B2")).toEqual([]);
    await expect(g.readRange("../x", "A1:B2")).rejects.toThrow();
    await expect(g.readRange(SHEET_ID, "A1:B2/../..")).rejects.toThrow();
    const denied = makeSheetsApi({ base: "https://sheets.invalid/v4", token: "t", fetch: (async () => json({ error: { status: "PERMISSION_DENIED" } }, 403)) as unknown as typeof fetch });
    await expect(denied.info(SHEET_ID)).rejects.toBeInstanceOf(CredentialError);
  });
  it("gatewayFor: mock for the sandbox token, refused in production", () => {
    expect(sheetsGatewayFor({ secrets: { access_token: "google-mock-token" }, env: {} }).kind).toBe("mock");
    expect(() => sheetsGatewayFor({ secrets: { access_token: "google-mock-token" }, env: { APP_ENV: "production" } })).toThrow(CredentialError);
  });
});

describe("preview and start (permissioned server-action targets)", () => {
  const vault = new Map<string, string>();
  const audits: { action: string; detail?: Record<string, unknown> }[] = [];
  const actor = { uid: "u", tenantId: "t-1", workspaceId: "w-1" };
  const d = (): RuntimeDeps => ({
    store: { getConnection: async (id: string) => (id === "c-1" ? { ...CONN, status: "sandbox" } : null), updateConnection: async () => {}, setCursor: async () => {}, getFieldMap: async () => [] } as unknown as RuntimeDeps["store"],
    vault: { putSecret: async (_n: string, v: string) => { const id = `v-${vault.size + 1}`; vault.set(id, v); return id; }, getSecret: async (id: string) => vault.get(id) ?? null, deleteSecret: async (id: string) => { vault.delete(id); } },
    env: { APP_ENV: "demo" }, log: { info() {}, warn() {}, error() {} }, audit: async (e) => { audits.push(e); },
  });
  const input = { spreadsheet: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`, range: "'Sample leads'!A1:F500", object: "lead" };
  beforeEach(() => { vault.clear(); vault.set("sec-1", JSON.stringify({ access_token: "google-mock-token", refresh_token: "r" })); audits.length = 0; });

  it("lists tabs and previews headers, a few rows, the suggested mapping and the plan, writing nothing", async () => {
    const tabs = await listSheetTabs(d(), actor, "c-1", input.spreadsheet);
    expect(tabs).toMatchObject({ ok: true, value: { spreadsheetId: SHEET_ID, tabs: [{ title: "Sample leads" }] } });
    const p = await previewSheet(d(), actor, "c-1", port, input);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.value.headers).toEqual(["Name", "Mobile", "Email", "Company", "City", "Source"]);
      expect(p.value.sample).toHaveLength(5);
      expect(p.value.mapping).toMatchObject({ Name: "full_name", Mobile: "phone", Email: "email" });
      expect(p.value.summary).toMatchObject({ total: 5, fresh: 3, duplicates: 1, invalid: 1 });
    }
    expect(port.writes).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });
  it("start stores the config (with the resolved mapping and a fresh nonce) in the Vault and audits, without any cell values", async () => {
    const r = await startSheetImport(d(), actor, "c-1", port, { ...input, resync: true });
    expect(r).toMatchObject({ ok: true, value: { stream: "import", summary: { total: 5 } } });
    const cfg = parseSheetConfig(JSON.parse([...vault.values()].at(-1)!)[CONFIG_KEY]);
    expect(cfg).toMatchObject({ spreadsheetId: SHEET_ID, object: "lead", resync: true, mode: "skip", mapping: { Name: "full_name", Email: "email" } });
    expect(cfg?.nonce).not.toBe("preview");
    expect(audits[0].action).toBe("google_sheets.import_requested");
    expect(JSON.stringify(audits[0])).not.toContain("example.invalid");
    const second = await startSheetImport(d(), actor, "c-1", port, input);
    if (second.ok && r.ok) expect(second.value.nonce).not.toBe(r.value.nonce);
  });
  it("refuses bad input, other workspaces' connections and an unmappable sheet", async () => {
    expect(await startSheetImport(d(), actor, "c-1", port, { ...input, spreadsheet: "nope" })).toEqual({ ok: false, code: "bad_spreadsheet" });
    expect(await startSheetImport(d(), actor, "c-1", port, { ...input, range: "A1:B2/../x" })).toEqual({ ok: false, code: "bad_range" });
    expect(await startSheetImport(d(), actor, "c-1", port, { ...input, object: "deal" })).toEqual({ ok: false, code: "bad_object" });
    expect(await startSheetImport(d(), { ...actor, workspaceId: "w-2" }, "c-1", port, input)).toEqual({ ok: false, code: "not_found" });
    expect(await previewSheet(d(), { ...actor, tenantId: "t-2" }, "c-1", port, input)).toEqual({ ok: false, code: "not_found" });
    expect(await startSheetImport(d(), actor, "c-1", port, { ...input, mapping: { Name: "" } })).toMatchObject({ ok: true });   // empty saved mapping falls back to auto-map
    expect(audits).toHaveLength(1);
  });
});
