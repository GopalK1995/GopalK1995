import { describe, expect, it } from "vitest";
import { systemPrincipal } from "@/lib/authz/principal";
import { ak, akAll } from "../strings";
import { checkKeyEscalation, createKeySchema, expiryFrom } from "../plan";
import type { Role } from "@/lib/data/types";

const actorOf = (role: Role) => {
  const p = systemPrincipal({ uid: "u1", workspaceId: "w1", role });
  return { p, actor: { uid: "u1", baseRole: role, held: p.grants } };
};

describe("creating a key cannot escalate privilege", () => {
  it("an owner may mint owner-level keys with any scope", () => {
    const { p, actor } = actorOf("owner");
    expect(checkKeyEscalation(actor, p, { role: "owner", scopes: ["leads:write", "deals:read", "records:write"] })).toMatchObject({ ok: true });
    // webhooks.manage is seeded in the database for owners; the demo fixture (legacy matrix) has no such key, so grant it explicitly
    const withHooks = { ...p, grants: { ...p.grants, "webhooks.manage": { scope: "all" as const } } };
    expect(checkKeyEscalation(actor, withHooks, { role: "owner", scopes: ["webhooks:write"] })).toMatchObject({ ok: true });
  });
  it("a sales manager cannot mint an owner key (role exceeds creator)", () => {
    const { p, actor } = actorOf("sales_manager");
    expect(checkKeyEscalation(actor, p, { role: "owner", scopes: ["leads:read"] })).toEqual({ ok: false, code: "role_exceeds_you" });
  });
  it("a creator cannot hand out a scope they could not use themselves", () => {
    const { p, actor } = actorOf("sales_manager");
    const r = checkKeyEscalation(actor, p, { role: "viewer", scopes: ["webhooks:write", "leads:read"] });
    expect(r).toEqual({ ok: false, code: "scope_not_held", scopes: ["webhooks:write"] });
  });
  it("unknown scopes are rejected before anything else", () => {
    const { p, actor } = actorOf("owner");
    expect(checkKeyEscalation(actor, p, { role: "viewer", scopes: ["admin:all"] })).toEqual({ ok: false, code: "unknown_scope", scopes: ["admin:all"] });
  });
  it("normalises scopes (dedupe, sort)", () => {
    const { p, actor } = actorOf("owner");
    const r = checkKeyEscalation(actor, p, { role: "viewer", scopes: ["leads:read", "leads:read", "contacts:read"] });
    expect(r).toEqual({ ok: true, scopes: ["contacts:read", "leads:read"] });
  });
});

describe("create input and copy", () => {
  it("validates the form", () => {
    const ok = { name: "Zapier", env: "live", role: "viewer", scopes: ["leads:read"], expiresInDays: 90 };
    expect(createKeySchema.safeParse(ok).success).toBe(true);
    for (const bad of [{ ...ok, name: "a" }, { ...ok, env: "prod" }, { ...ok, role: "god" }, { ...ok, scopes: [] }, { ...ok, expiresInDays: 0 }, { ...ok, expiresInDays: 4000 }, { ...ok, extra: 1 }]) {
      expect(createKeySchema.safeParse(bad).success).toBe(false);
    }
  });
  it("computes expiry", () => {
    expect(expiryFrom(null)).toBeNull();
    expect(expiryFrom(30, Date.parse("2026-10-01T00:00:00Z"))).toBe("2026-10-31T00:00:00.000Z");
  });
  it("copy has no em dashes and fills placeholders", () => {
    for (const v of Object.values(akAll())) expect(v).not.toContain("—");
    expect(ak("revokeTitle", { name: "Zapier" })).toBe("Revoke Zapier?");
    expect(ak("missing_key")).toBe("missing_key");
  });
});
