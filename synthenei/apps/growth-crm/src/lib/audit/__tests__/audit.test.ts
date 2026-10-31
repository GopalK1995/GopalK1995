import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { mockDb, ok, err, has } from "@/lib/db/__tests__/mock";
import * as record from "../record";
import * as query from "../query";
import * as redact from "../redact";
import { audit, buildAuditArgs, actorFromPrincipal, platformActor } from "../record";
import { auditCsv, cleanFilters, csvCell, maskAuditView, queryAudit, toAuditView } from "../query";
import { redactDetail, redactLine } from "../redact";
import { AuditError, type AuditActor } from "../types";
import { systemPrincipal } from "@/lib/authz/principal";

const actor: AuditActor = { uid: "u1", kind: "user", workspaceId: "w1", source: "ui", impersonation: false, requestId: "r-1" };
const WS = "11111111-1111-4111-8111-111111111111";

describe("redaction", () => {
  it("removes password, token, key, cookie and authorization values at any depth", () => {
    const out = redactDetail({
      password: "hunter2", newPassword: "x", apiKey: "abc", api_key: "abc", access_token: "t", refreshToken: "t", client_secret: "s", Authorization: "Bearer abc.def.ghi",
      cookie: "sid=1", nested: { webhookSecret: "w", deep: [{ privateKey: "k", ok: "kept" }] }, otp: "123456", ok: "visible",
    }) as Record<string, unknown>;
    const s = JSON.stringify(out);
    for (const secret of ["hunter2", "abc", "sid=1", "123456"]) expect(s).not.toContain(secret);
    expect(out.password).toBe("[redacted]");
    expect((out.nested as { deep: { ok: string }[] }).deep[0].ok).toBe("kept");
    expect(out.ok).toBe("visible");
  });
  it("scrubs secret-shaped values inside free text", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij";
    const txt = redactLine(`token=abc123 sent with Bearer zzzzzzzzzzzz and ${jwt} key sk-live1234567890abcdef`, 300);
    expect(txt).not.toMatch(/abc123|zzzzzzzzzzzz|eyJhbGci|sk-live/);
  });
  it("masks personal fields and personal values in text", () => {
    const out = redactDetail({ email: "a@b.in", phone: "+91 98765 43210", note: "call me", memo: "mail ravi@x.in or +91 98765 43210" }) as Record<string, string>;
    expect(out.email).toBe("[pii]");
    expect(out.phone).toBe("[pii]");
    expect(out.memo).toBe("mail [email] or [phone]");
  });
  it("is bounded", () => {
    const deep: Record<string, unknown> = {}; let cur = deep;
    for (let i = 0; i < 20; i++) { const n: Record<string, unknown> = {}; cur.x = n; cur = n; }
    expect(JSON.stringify(redactDetail(deep))).toContain("[truncated]");
    expect((redactDetail({ s: "a".repeat(5000) }) as { s: string }).s.length).toBeLessThan(600);
  });
});

describe("buildAuditArgs", () => {
  it("rejects a bad action and an empty summary", () => {
    expect(() => buildAuditArgs(actor, { action: "Bad Action", summary: "x" })).toThrow(AuditError);
    expect(() => buildAuditArgs(actor, { action: "audit.exported", summary: "  " })).toThrow(AuditError);
  });
  it("requires a reason for config, role, permission and support actions", () => {
    for (const a of ["config.changed", "role.updated", "permission.granted", "support.write"]) {
      expect(() => buildAuditArgs(actor, { action: a, summary: "s" })).toThrow(/reason/);
      expect(() => buildAuditArgs(actor, { action: a, summary: "s", reason: "short" })).toThrow(/reason/);
      expect(buildAuditArgs(actor, { action: a, summary: "s", reason: "Owner asked on ticket 41" }).p_reason).toBe("Owner asked on ticket 41");
    }
    expect(buildAuditArgs(actor, { action: "audit.exported", summary: "s" }).p_reason).toBeNull();
  });
  it("redacts detail and reason, carries request id and actor", () => {
    const a = buildAuditArgs(actor, { action: "config.changed", summary: "Set token=abc123", reason: "rotate password=hunter2 now", detail: { apiKey: "k", stage: "won" }, object: { table: "tenant_config", id: "t1" } });
    expect(JSON.stringify(a)).not.toMatch(/abc123|hunter2|"k"/);
    expect(a).toMatchObject({ p_workspace: "w1", p_request_id: "r-1", p_source: "ui", p_actor_kind: "user", p_object_table: "tenant_config", p_object_id: "t1", p_impersonation: false });
    expect(a.p_detail).toEqual({ apiKey: "[redacted]", stage: "won" });
  });
  it("flags impersonation inside a support session", () => {
    const p = systemPrincipal({ uid: "admin", workspaceId: WS, role: "owner", tenantId: "t", modulesOff: [], tenant: { status: "active" }, support: { mode: "read_write" } });
    const a = buildAuditArgs(actorFromPrincipal(p), { action: "support.write", summary: "edited a lead", reason: "Ticket 118 follow-up" });
    expect(a).toMatchObject({ p_impersonation: true, p_source: "support", p_actor_kind: "support" });
    expect((a.p_detail as Record<string, unknown>).impersonation).toBe(true);
  });
  it("platform actor has no workspace", () => {
    expect(buildAuditArgs(platformActor("p1"), { action: "audit.exported", summary: "s" })).toMatchObject({ p_workspace: null, p_actor_kind: "platform_admin" });
  });
});

type RpcCall = { fn: string; args: Record<string, unknown> };
function rpcDb(result: { data: unknown; error: { code?: string } | null }) {
  const calls: RpcCall[] = [];
  const db = { rpc: (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return Promise.resolve(result); }, from: () => { throw new Error("no table access"); } } as unknown as Db;
  return { db, calls };
}

describe("audit()", () => {
  it("writes through the audit_record RPC only", async () => {
    const { db, calls } = rpcDb({ data: 41, error: null });
    const r = await audit(actor, { action: "audit.exported", summary: "Exported 3 rows" }, async () => db);
    expect(r).toEqual({ ok: true, id: "41", demo: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("audit_record");
  });
  it("demo never touches Supabase", async () => {
    let touched = false;
    const r = await audit({ ...actor, demo: true }, { action: "audit.exported", summary: "s" }, async () => { touched = true; throw new Error("x"); });
    expect(r.demo).toBe(true);
    expect(touched).toBe(false);
  });
  it("a failed write throws so the caller can cancel the action", async () => {
    const { db } = rpcDb({ data: null, error: { code: "42501" } });
    await expect(audit(actor, { action: "audit.exported", summary: "s" }, async () => db)).rejects.toMatchObject({ name: "AuditError", code: "failed" });
    await expect(audit(actor, { action: "audit.exported", summary: "s" }, async () => { throw new Error("down"); })).rejects.toMatchObject({ code: "unavailable" });
  });
  it("audit.record is the same function", () => expect(audit.record).toBe(audit));
});

describe("append-only: no mutation API", () => {
  it("exports no update, delete, upsert, truncate or remove function", () => {
    const names = [...Object.keys(record), ...Object.keys(query), ...Object.keys(redact)];
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((n) => /update|delete|upsert|truncate|remove|purge|edit|clear/i.test(n))).toEqual([]);
  });
  it("no source file in src/lib/audit or the audit pages issues a write query", () => {
    const root = join(__dirname, "..");
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== "__tests__") walk(p); } else if (/\.tsx?$/.test(f)) files.push(p); } };
    walk(root);
    files.push(join(root, "../../app/(app)/settings/_components/audit-tab.tsx"), join(root, "../../app/(app)/settings/audit/page.tsx"), join(root, "../../app/admin/(console)/audit/page.tsx"));
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\.(update|delete|upsert|insert)\(/);
      for (const m of src.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)) expect(m[1], f).toBe("audit_record");
    }
  });
});

describe("queryAudit", () => {
  const row = (id: number, at: string) => ({ id, occurred_at: at, table_name: "leads", action: "update", actor_label: "Meena", source: "ui", support_session_id: null });
  it("scopes to the workspace, applies filters and builds a keyset cursor", async () => {
    const rows = [row(30, "2026-10-12T10:00:00+00:00"), row(29, "2026-10-12T09:00:00+00:00"), row(28, "2026-10-12T08:00:00+00:00")];
    const { db, calls } = mockDb([ok(rows)]);
    const page = await queryAudit(db, { workspaceId: WS }, { action: "update", object: "leads", source: "ui", from: "2026-10-01", to: "2026-10-31", actor: "Meena" }, undefined, 2);
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBeTruthy();
    const c = calls[0];
    expect(c.table).toBe("audit_log");
    expect(has(c, "eq", "workspace_id", WS)).toBe(true);
    expect(has(c, "eq", "action", "update")).toBe(true);
    expect(has(c, "eq", "table_name", "leads")).toBe(true);
    expect(has(c, "eq", "source", "ui")).toBe(true);
    expect(has(c, "ilike", "actor_label", "%Meena%")).toBe(true);
    expect(has(c, "gte", "occurred_at", "2026-10-01T00:00:00+05:30")).toBe(true);
    expect(has(c, "lt", "occurred_at", "2026-11-01T00:00:00+05:30")).toBe(true);
    expect(has(c, "limit", 3)).toBe(true);
    expect(c.ops.every(([o]) => !["insert", "update", "delete", "upsert"].includes(o))).toBe(true);
    const next = await mockDb([ok([])]);
    await queryAudit(next.db, { workspaceId: WS }, {}, page.nextCursor!, 2);
    expect(next.calls[0].ops.some(([o, a]) => o === "or" && String(a[0]).includes("id.lt.29"))).toBe(true);
  });
  it("actor uuid filters by id; junk filter values are dropped; bad cursor is rejected", async () => {
    const u = "22222222-2222-4222-8222-222222222222";
    const { db, calls } = mockDb([ok([])]);
    await queryAudit(db, { workspaceId: WS }, { actor: u, action: "DROP TABLE", source: "evil", from: "yesterday" });
    expect(has(calls[0], "eq", "actor_id", u)).toBe(true);
    expect(calls[0].ops.some(([, a]) => JSON.stringify(a).match(/DROP|evil|yesterday/))).toBe(false);
    await expect(queryAudit(mockDb([]).db, {}, {}, Buffer.from(JSON.stringify({ v: 'x"', id: "1" })).toString("base64url"))).rejects.toMatchObject({ code: "invalid" });
  });
  it("platform scope has no workspace filter unless asked; tenant tab uses an in() list", async () => {
    const a = mockDb([ok([])]);
    await queryAudit(a.db, {}, { tenant: WS });
    expect(a.calls[0].ops.some(([o, x]) => o === "eq" && x[0] === "workspace_id")).toBe(false);
    expect(has(a.calls[0], "eq", "tenant_id", WS)).toBe(true);
    const b = mockDb([ok([])]);
    await queryAudit(b.db, { workspaceIds: [WS, "not-a-uuid"] }, {});
    expect(has(b.calls[0], "in", "workspace_id", [WS])).toBe(true);
  });
  it("surfaces database errors", async () => {
    await expect(queryAudit(mockDb([err("42501")]).db, { workspaceId: WS }, {})).rejects.toMatchObject({ code: "denied" });
  });
});

describe("PII masking", () => {
  const v = toAuditView({ id: 1, occurred_at: "2026-10-12T10:00:00Z", table_name: "leads", action: "update", actor_label: "Meena", ip: "49.204.11.9", user_agent: "UA", summary: "update lead ravi@x.in +91 98765 43210",
    changes: { email: "ravi@x.in", status: "won", note: { password: "p" }, api_token: "t" } });
  it("hides ip, user agent and personal values without pii.read", () => {
    const m = maskAuditView(v, false);
    expect(m.ip).toBe("");
    expect(m.userAgent).toBe("");
    expect(m.summary).toBe("update lead [email] [phone]");
    expect(JSON.stringify(m.changes)).not.toMatch(/ravi|password|"p"|"t"/);
  });
  it("keeps personal values with pii.read but never secrets", () => {
    const m = maskAuditView(v, true);
    expect(m.ip).toBe("49.204.11.9");
    expect(m.summary).toContain("ravi@x.in");
    expect(JSON.stringify(m.changes)).toContain("ravi@x.in");
    expect(JSON.stringify(m.changes)).not.toContain('"t"');
  });
  it("marks support rows", () => {
    expect(toAuditView({ id: 2, support_session_id: "s1", table_name: "leads", action: "update" }).support).toBe(true);
    expect(toAuditView({ id: 3, table_name: "leads", action: "update" }).support).toBe(false);
  });
});

describe("csv", () => {
  it("neutralises spreadsheet formulas and quotes separators", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });
  it("writes a header and one line per row, no changes column", () => {
    const csv = auditCsv([toAuditView({ id: 1, occurred_at: "2026-10-12T10:00:00Z", table_name: "leads", action: "update", actor_label: "M", changes: { email: "x" } })]);
    expect(csv.split("\r\n")[0]).toContain("when_utc,actor");
    expect(csv).not.toContain("x@");
    expect(csv.trim().split("\r\n")).toHaveLength(2);
  });
  it("cleanFilters keeps well-formed values only", () => {
    expect(cleanFilters({ object: "leads:abc", source: "api", from: "2026-01-02" })).toEqual({ object: "leads:abc", source: "api", from: "2026-01-02" });
    expect(cleanFilters({ object: "leads;drop", source: "x", from: "1/2/26" })).toEqual({});
  });
});
