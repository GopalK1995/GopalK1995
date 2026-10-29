// Multi-tenant model: types + loader facade.
// TENANT = white-label client org (brand). WORKSPACE = isolated data area inside a tenant. ROLE is per workspace membership.
// Real sessions resolve tenant/workspace/role from the my_workspaces() RPC (loadMyWorkspaces + activeFromRow below).
// Demo sessions read the synthetic fixture in ./demo/tenancy-fixture, re-exported here only so legacy demo screens keep
// working until their owning tasks move to the loader. New code must not import the demo arrays.
// No Node APIs, no server imports: imported by middleware (edge) too.
import type { Role } from "./data/types";
import type { TenantConfigOverrides } from "./vertical";

export interface Tenant {
  id: string; name: string; product: string; hue: number; monogram: string;
  plan: "Growth" | "Scale" | "Pilot"; seats: number; primaryOwnerId: string; status: "active" | "suspended" | "trial"; createdAt: string; supportEmail: string;
  /** Industry vocabulary set. Absent = legal. */ vertical?: "legal" | "hospitality";
  /** Effective tenant config for this request (attached by requireActive; never stored on the static record). */ config?: TenantConfigOverrides;
}
export interface Workspace { id: string; /** DB uuid (BACKEND demo seed) */ uuid: string; tenantId: string; name: string; region: string; createdAt: string; dataset: "tn" | "kerala" | "kaveri" | "wg" }
export interface PlatformUser { id: string; name: string; email: string; platformAdmin?: boolean; lastSignIn: string; status: "active" | "invited" | "deactivated" }
export interface Membership { userId: string; workspaceId: string; role: Role }

/** One row of the my_workspaces() RPC (see supabase/migrations/0007_rpcs.sql). */
export interface MyWorkspaceRow {
  workspace_id: string; workspace_name: string; workspace_slug: string; region_label: string | null; is_demo: boolean;
  tenant_id: string; tenant_name: string; tenant_slug: string; branding: Record<string, unknown> | null; role: Role;
  via_support_session: boolean; support_session_expires_at: string | null;
}
/** A workspace the caller can enter, with its tenant. */
export interface ActiveOption { ws: Workspace; tenant: Tenant; role: Role; viaSupport: boolean }

/** The smallest slice of a Supabase client the loader needs (keeps this file edge-safe and mockable). */
export interface RpcClient { rpc(fn: "my_workspaces"): PromiseLike<{ data: unknown; error?: unknown }> }

const DEFAULT_HUE = 220;
const str = (v: unknown, d = "") => (typeof v === "string" && v.trim() ? v : d);

/** Map one RPC row to the Workspace/Tenant shapes the app already uses. ws.id is the DB uuid; tenant.id is the tenant slug. */
export function activeFromRow(r: MyWorkspaceRow): ActiveOption {
  const b = r.branding ?? {};
  const name = str(b.brand_name, r.tenant_name);
  const tenant: Tenant = {
    id: r.tenant_slug, name, product: r.tenant_name, hue: DEFAULT_HUE, monogram: (name.trim()[0] ?? "?").toUpperCase(),
    plan: "Growth", seats: 0, primaryOwnerId: "", status: "active", createdAt: "", supportEmail: str(b.support_email),
  };
  const ws: Workspace = { id: r.workspace_id, uuid: r.workspace_id, tenantId: r.tenant_slug, name: r.workspace_name, region: str(r.region_label), createdAt: "", dataset: "tn" };
  return { ws, tenant, role: r.role, viaSupport: r.via_support_session };
}

/** Calls my_workspaces() and maps the rows. Returns null when the call fails (caller decides; never silently trusts cookies). */
export async function loadMyWorkspaces(sb: RpcClient): Promise<ActiveOption[] | null> {
  const { data, error } = await sb.rpc("my_workspaces");
  if (error || !Array.isArray(data)) return null;
  return (data as MyWorkspaceRow[]).map(activeFromRow);
}

// Legacy re-exports of the demo fixture (demo mode only; to be removed screen by screen).
export { TENANTS, WORKSPACES, USERS, MEMBERSHIPS, PERSONAS, workspaceById, tenantOf, membershipsFor, userById } from "./demo/tenancy-fixture";
