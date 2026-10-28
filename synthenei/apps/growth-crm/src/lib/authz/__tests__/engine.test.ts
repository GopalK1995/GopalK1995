import { describe, expect, it } from "vitest";
import { AuthzError, decide, denyMessageKey, enforce, explain, maskRecord, scopeFilter } from "../engine";
import { evaluateConditions, validateConditions } from "../conditions";
import { principalFromMyGrants, systemPrincipal } from "../principal";
import { moduleOfPermission, pagePermission } from "../pages";
import { PERMISSIONS, permissionDef } from "../catalog";
import type { Principal, RecordRef } from "../types";

const MASKED = "••••";
type In = Parameters<typeof systemPrincipal>[0];
const rec = (o: Partial<RecordRef> = {}): RecordRef => ({ type: "lead", workspaceId: "w", ownerId: "someone", ...o });
const user = (role: In["role"], o: Partial<In> = {}) => systemPrincipal({ uid: "me", workspaceId: "w", role, ...o });
const withGrant = (p: Principal, perm: string, g: Principal["grants"][string]): Principal => ({ ...p, grants: { ...p.grants, [perm]: g } });

describe("catalogue", () => {
  it("has unique keys and the contract's platform/support flags", () => {
    expect(new Set(PERMISSIONS.map((p) => p.key)).size).toBe(PERMISSIONS.length);
    expect(permissionDef("platform.read")?.platformOnly).toBe(true);
    expect(permissionDef("leads.export")?.supportBlocked).toBe(true);
    expect(permissionDef("platform.tenants.manage")?.resource).toBe("platform.tenants");
  });
  it("maps pages and modules", () => {
    expect(pagePermission("/leads/123")).toBe("leads.read");
    expect(pagePermission("/o/events")).toBe("obj:events.read");
    expect(pagePermission("/profile")).toBeNull();
    expect(pagePermission("/nope")).toBeUndefined();
    expect(moduleOfPermission("campaigns.write")).toBe("campaigns");
    expect(moduleOfPermission("leads.read")).toBeUndefined();
  });
});

describe("evaluation order", () => {
  it("1 unauthenticated", () => expect(decide(null, "leads.read")).toMatchObject({ allow: false, reason: "unauthenticated", step: 1 }));
  it("2 org suspended denies writes, reads pass; expired trial is read-only", () => {
    expect(decide(user("owner", { tenant: { status: "suspended" } }), "leads.write")).toMatchObject({ reason: "org_suspended", step: 2 });
    expect(decide(user("owner", { tenant: { status: "suspended" } }), "leads.read").allow).toBe(true);
    const t = { status: "trial" as const, trialEndsAt: "2026-01-01T00:00:00Z" };
    expect(decide(user("owner", { tenant: t }), "leads.write", undefined, new Date("2026-02-01"))).toMatchObject({ reason: "org_readonly", step: 2 });
    expect(decide(user("owner", { tenant: t }), "leads.write", undefined, new Date("2025-12-01")).allow).toBe(true);
  });
  it("3 module off and plan cap", () => {
    expect(decide(user("owner", { modulesOff: ["campaigns"] }), "campaigns.read")).toMatchObject({ reason: "module_off", step: 3 });
    expect(decide(user("owner", { capped: ["integrations.manage"] }), "integrations.manage")).toMatchObject({ reason: "plan_limit", step: 3 });
  });
  it("4 support overlay", () => {
    expect(decide(user("sales_rep", { support: { mode: "read_write" } }), "leads.export")).toMatchObject({ reason: "support_blocked", step: 4 });
    expect(decide(user("owner", { support: { mode: "read_only" } }), "leads.write")).toMatchObject({ reason: "support_readonly", step: 4 });
    expect(decide(user("viewer", { support: { mode: "read_write" } }), "leads.write").allow).toBe(true);
    expect(decide({ ...user("owner"), kind: "platform_admin" }, "leads.read")).toMatchObject({ reason: "no_permission", step: 4 });
  });
  it("5 missing or none grant", () => {
    expect(decide(user("viewer"), "leads.write")).toMatchObject({ reason: "no_permission", step: 5 });
    expect(decide(withGrant(user("owner"), "leads.write", { scope: "none" }), "leads.write").reason).toBe("no_permission");
    expect(decide(user("owner"), "platform.read").reason).toBe("no_permission");
  });
  it("6 scopes", () => {
    const rep = user("sales_rep", { attrs: { districts: ["Madurai"] } });
    expect(decide(rep, "leads.read", rec({ ownerId: "me" })).allow).toBe(true);
    expect(decide(rep, "leads.read", rec({ assigneeId: "me" })).allow).toBe(true);
    expect(decide(rep, "leads.read", rec())).toMatchObject({ reason: "out_of_scope", step: 6 });
    expect(decide(rep, "leads.read", rec({ ownerId: null, attrs: { district: "Madurai" } })).allow).toBe(true);
    expect(decide(rep, "leads.read", rec({ ownerId: null, attrs: { district: "Chennai" } })).reason).toBe("out_of_scope");
    expect(decide(rep, "leads.read", rec({ workspaceId: "other", ownerId: "me" })).reason).toBe("out_of_scope");
    const mgr = withGrant(user("sales_manager", { teamUserIds: ["me", "rep1"] }), "tasks.write", { scope: "team" });
    expect(decide(mgr, "tasks.write", rec({ ownerId: "rep1" })).allow).toBe(true);
    expect(decide(mgr, "tasks.write", rec({ ownerId: null })).allow).toBe(true);
    expect(decide(mgr, "tasks.write", rec({ ownerId: "x" })).reason).toBe("out_of_scope");
  });
  it("6 sharing: viewer reads only, editor writes, team and role subjects", () => {
    const rep = withGrant(withGrant(user("sales_rep", { teamIds: ["t1"] }), "deals.write", { scope: "own" }), "deals.read", { scope: "own" });
    const viewer = rec({ sharedWith: [{ relation: "viewer", subjectType: "user", subjectId: "me" }] });
    expect(decide(rep, "deals.read", viewer).allow).toBe(true);
    expect(decide(rep, "deals.write", viewer).reason).toBe("out_of_scope");
    expect(decide(rep, "deals.write", rec({ sharedWith: [{ relation: "editor", subjectType: "team", subjectId: "t1" }] })).allow).toBe(true);
    expect(decide(rep, "deals.write", rec({ sharedWith: [{ relation: "owner", subjectType: "role", subjectId: "sales_rep" }] })).allow).toBe(true);
  });
  it("7 conditions, fail closed", () => {
    const cond = { all: [{ field: "record.district", op: "in", value: "@principal.attrs.districts" }] };
    const base = withGrant(user("owner", { attrs: { districts: ["Madurai"] } }), "leads.write", { scope: "all", conditions: cond });
    expect(decide(base, "leads.write", rec({ attrs: { district: "Madurai" } })).allow).toBe(true);
    expect(decide(base, "leads.write", rec({ attrs: { district: "Chennai" } }))).toMatchObject({ reason: "condition_failed", step: 7 });
    expect(decide(base, "leads.write").allow).toBe(true); // list-level: record-dependent conditions are not applied
    const bad = withGrant(base, "leads.write", { scope: "all", conditions: { all: [{ field: "record.x", op: "regex", value: "." }] } });
    expect(decide(bad, "leads.write", rec()).reason).toBe("condition_failed");
  });
  it("8 masking", () => {
    expect(decide(user("viewer"), "leads.read").maskedFields).toEqual(["email", "phone"]);
    expect(decide(user("owner"), "leads.read").maskedFields).toEqual([]);
    expect(decide(withGrant(user("owner"), "leads.read", { scope: "all", fieldMask: ["notes"] }), "leads.read").maskedFields).toEqual(["notes"]);
  });
});

describe("conditions", () => {
  const ctx = (now = "2026-10-28T06:00:00Z") => ({ record: { district: "Madurai", n: 5, tags: ["a"], consent: true }, principal: { uid: "me", attrs: { districts: ["Madurai"] } }, now: new Date(now) });
  const c = (field: string, op: string, value?: unknown, extra: object = {}) => evaluateConditions({ all: [{ field, op, value, ...extra }] }, ctx());
  it("operators", () => {
    expect(c("record.district", "eq", "Madurai")).toBe(true);
    expect(c("record.district", "neq", "Madurai")).toBe(false);
    expect(c("record.district", "nin", ["Chennai"])).toBe(true);
    expect(c("record.tags", "contains", "a")).toBe(true);
    expect(c("record.n", "gte", 5)).toBe(true);
    expect(c("record.n", "lte", 4)).toBe(false);
    expect(c("record.consent", "is_true")).toBe(true);
    expect(c("principal.uid", "eq", "me")).toBe(true);
    expect(c("record.missing", "eq", undefined)).toBe(false);
  });
  it("between_hours in a timezone, including overnight windows", () => {
    // 06:00Z is 11:30 IST
    expect(c("now", "between_hours", ["09:00", "20:00"], { tz: "Asia/Kolkata" })).toBe(true);
    expect(c("now", "between_hours", ["12:00", "20:00"], { tz: "Asia/Kolkata" })).toBe(false);
    expect(c("now", "between_hours", ["22:00", "07:00"], { tz: "UTC" })).toBe(true);
  });
  it("any/all nesting and limits", () => {
    expect(evaluateConditions({ any: [{ field: "record.n", op: "eq", value: 1 }, { all: [{ field: "record.n", op: "eq", value: 5 }] }] }, ctx())).toBe(true);
    expect(evaluateConditions({ all: [{ all: [{ all: [{ field: "record.n", op: "eq", value: 5 }] }] }] }, ctx())).toBe(false);
    const many = { all: Array.from({ length: 11 }, () => ({ field: "record.n", op: "eq", value: 5 })) };
    expect(evaluateConditions(many, ctx())).toBe(false);
    expect(evaluateConditions({}, ctx())).toBe(true);
    expect(evaluateConditions(null, ctx())).toBe(true);
  });
  it("validateConditions reports unknown operators and prefixes", () => {
    expect(validateConditions({ all: [{ field: "record.a", op: "eq", value: 1 }] })).toEqual([]);
    expect(validateConditions({ all: [{ field: "user.a", op: "eq" }] }).length).toBe(1);
    expect(validateConditions({ all: [{ field: "record.a", op: "like" }] }).length).toBe(1);
    expect(validateConditions({ all: [{ field: "now", op: "between_hours", value: ["9", "20"] }] }).length).toBe(1);
  });
});

describe("helpers", () => {
  it("enforce throws AuthzError with the decision; denyMessageKey maps the reason", () => {
    let err: unknown;
    try { enforce(user("viewer"), "leads.write"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AuthzError);
    expect(denyMessageKey((err as AuthzError).decision)).toBe("errors.authz.no_permission");
    expect(enforce(user("owner"), "leads.write").uid).toBe("me");
  });
  it("explain lists each step and stops at the first deny", () => {
    const e = explain(user("viewer"), "leads.write");
    expect(e.decision.reason).toBe("no_permission");
    expect(e.steps.map((s) => [s.step, s.passed])).toEqual([[1, true], [2, true], [3, true], [4, true], [5, false]]);
    expect(explain(user("owner"), "leads.read").steps.at(-1)?.step).toBe(8);
  });
  it("maskRecord masks PII for roles without pii.read and leaves others", () => {
    const row = { id: 1, email: "a@b.in", phone: "999", name: "N", notes: "x" };
    expect(maskRecord(user("viewer"), "lead", row)).toMatchObject({ email: MASKED, phone: MASKED, name: "N" });
    expect(maskRecord(user("viewer"), "lead", row, ["notes"]).notes).toBe(MASKED);
    expect(maskRecord(user("owner"), "lead", row)).toEqual(row);
    expect(maskRecord(withGrant(user("owner"), "leads.read", { scope: "all", fieldMask: ["phone"] }), "lead", row).phone).toBe(MASKED);
    expect(row.email).toBe("a@b.in");
  });
  it("scopeFilter", () => {
    expect(scopeFilter(user("owner"), "leads.read")).toEqual({ scope: "all", ownerIds: null });
    expect(scopeFilter(user("sales_rep"), "leads.read")).toEqual({ scope: "own", ownerIds: ["me"] });
    expect(scopeFilter(user("viewer"), "leads.write")).toEqual({ scope: "none", ownerIds: [] });
    expect(scopeFilter(withGrant(user("owner", { teamUserIds: ["me", "r"] }), "tasks.read", { scope: "team" }), "tasks.read").ownerIds).toEqual(["me", "r"]);
  });
  it("principalFromMyGrants maps the RPC shape and fails closed on garbage", () => {
    const p = principalFromMyGrants({ role: { key: "custom" }, perms: { "leads.read": { scope: "team", conditions: {}, field_mask: ["phone"] }, "x.y": { scope: "bogus" } },
      team_user_ids: ["me", "r"], attrs: { districts: ["M"] }, support: { mode: "read_only" }, tenant: { uuid: "t", status: "suspended" } }, { uid: "me", workspaceId: "w" });
    expect(p.grants["leads.read"]).toMatchObject({ scope: "team", fieldMask: ["phone"] });
    expect(p.grants["x.y"].scope).toBe("none");
    expect(p.support).toEqual({ mode: "read_only" });
    expect(p.tenant?.status).toBe("suspended");
    expect(decide(principalFromMyGrants(null, { uid: "me", workspaceId: "w" }), "leads.read").reason).toBe("no_permission");
  });
});
