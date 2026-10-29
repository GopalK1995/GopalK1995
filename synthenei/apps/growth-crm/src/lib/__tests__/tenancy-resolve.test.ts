import { describe, expect, it, vi } from "vitest";
import { resolveActive, resolveHint } from "../auth/context";
import { activeFromRow, loadMyWorkspaces, type MyWorkspaceRow } from "../tenancy";
import type { Session, SupportSession } from "../auth/session";

const base = { name: "N", email: "n@x.test", platformAdmin: false, iat: 0 };
const demo = (memberships: Session["memberships"]): Session => ({ ...base, uid: "u-nithya", demo: true, memberships });
const real = (memberships: Session["memberships"]): Session => ({ ...base, uid: "uuid-1", demo: false, memberships });
const row = (id: string, slug: string, role: MyWorkspaceRow["role"], via = false): MyWorkspaceRow => ({
  workspace_id: id, workspace_name: `WS ${id}`, workspace_slug: `ws-${id}`, region_label: "Region", is_demo: false,
  tenant_id: `t-${slug}`, tenant_name: `Tenant ${slug}`, tenant_slug: slug, branding: { brand_name: `Brand ${slug}`, support_email: "s@x.test" },
  role, via_support_session: via, support_session_expires_at: null,
});

describe("resolveActive: demo fixture path", () => {
  it("uses the cookie workspace when it is a membership", () => {
    const a = resolveActive(demo([{ ws: "lawsome-tn", role: "marketing" }, { ws: "kaveri-cbe", role: "viewer" }]), "kaveri-cbe", null);
    expect(a?.ws.id).toBe("kaveri-cbe"); expect(a?.role).toBe("viewer"); expect(a?.tenant.id).toBe("kaveri-demo");
  });
  it("falls back to the first membership for a foreign or missing cookie", () => {
    const s = demo([{ ws: "lawsome-tn", role: "marketing" }]);
    expect(resolveActive(s, "shola-mist-coonoor", null)?.ws.id).toBe("lawsome-tn");
    expect(resolveActive(s, undefined, null)?.ws.id).toBe("lawsome-tn");
  });
  it("platform admin needs a support session; read_only is viewer, read_write is owner", () => {
    const s: Session = { ...demo([]), platformAdmin: true };
    const sup = (mode: SupportSession["mode"]): SupportSession => ({ ws: "lawsome-tn", mode, reason: "r", admin: "a", endsAt: 1, iat: 0 });
    expect(resolveActive(s, undefined, null)).toBeNull();
    expect(resolveActive(s, undefined, sup("read_only"))?.role).toBe("viewer");
    expect(resolveActive(s, undefined, sup("read_write"))?.role).toBe("owner");
  });
  it("returns null with no memberships", () => expect(resolveActive(demo([]), undefined, null)).toBeNull());
});

describe("resolveActive: real sessions from my_workspaces()", () => {
  const options = [activeFromRow(row("w1", "acme", "sales_manager")), activeFromRow(row("w2", "acme", "viewer")), activeFromRow(row("w3", "beta", "owner"))];
  it("takes tenant, workspace and role from the DB rows, not the cookie hint", () => {
    const a = resolveActive(real([{ ws: "w1", role: "owner" }]), "w1", null, options);
    expect(a?.role).toBe("sales_manager"); expect(a?.tenant.id).toBe("acme"); expect(a?.tenant.name).toBe("Brand acme");
    expect(a?.options).toHaveLength(3);
  });
  it("switches to another listed workspace by cookie, ignores one that is not listed", () => {
    const s = real([{ ws: "w1", role: "viewer" }]);
    expect(resolveActive(s, "w3", null, options)?.ws.id).toBe("w3");
    expect(resolveActive(s, "not-mine", null, options)?.ws.id).toBe("w1");
  });
  it("returns null when the DB lists nothing", () => expect(resolveActive(real([{ ws: "w1", role: "owner" }]), "w1", null, [])).toBeNull());
  it("platform admin only resolves a support-session workspace", () => {
    const s: Session = { ...real([]), platformAdmin: true };
    const opts = [...options, activeFromRow(row("w9", "gamma", "viewer", true))];
    const sup: SupportSession = { ws: "w9", mode: "read_write", reason: "r", admin: "a", endsAt: 1, iat: 0 };
    expect(resolveActive(s, undefined, sup, opts)?.ws.id).toBe("w9");
    expect(resolveActive(s, undefined, { ...sup, ws: "w1" }, opts)).toBeNull();
  });
});

describe("resolveHint (edge, no DB)", () => {
  it("demo: carries the fixture tenant; foreign cookie falls back", () => {
    const h = resolveHint(demo([{ ws: "shola-mist-coonoor", role: "owner" }]), "lawsome-tn", null);
    expect(h).toEqual({ wsId: "shola-mist-coonoor", role: "owner", demoTenantId: "shola-mist" });
  });
  it("real: trusts the cookie role as a hint only, no tenant", () => {
    expect(resolveHint(real([{ ws: "w1", role: "viewer" }]), "w1", null)).toEqual({ wsId: "w1", role: "viewer" });
  });
  it("null when no membership", () => expect(resolveHint(real([]), undefined, null)).toBeNull());
});

describe("loadMyWorkspaces", () => {
  it("maps rows and falls back to tenant name / monogram", async () => {
    const r = row("w1", "acme", "owner"); r.branding = {};
    const out = await loadMyWorkspaces({ rpc: vi.fn().mockResolvedValue({ data: [r] }) });
    expect(out?.[0].tenant.name).toBe("Tenant acme"); expect(out?.[0].tenant.monogram).toBe("T"); expect(out?.[0].ws.id).toBe("w1");
  });
  it("returns null on error or non-array", async () => {
    expect(await loadMyWorkspaces({ rpc: async () => ({ data: null, error: new Error("x") }) })).toBeNull();
    expect(await loadMyWorkspaces({ rpc: async () => ({ data: {} }) })).toBeNull();
  });
});
