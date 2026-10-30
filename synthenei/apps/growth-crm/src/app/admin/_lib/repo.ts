// Platform repository: every function takes a request-scoped Db (the signed-in platform admin's JWT), so RLS and the
// is_platform_admin() / super_admin checks inside the RPCs are the real enforcement; assertPlatform is the first gate.
// Metadata and aggregate counts only. No function here reads a business table.
import type { Db } from "@/lib/db/client";
import { mapPgError, throwIfError } from "@/lib/db/errors";
import { from } from "@/lib/db/query";

type PgErr = { code?: string; message?: string } | null;
type Rpc = { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: PgErr }> };
const rpc = (db: Db, fn: string, args?: Record<string, unknown>) => (db as unknown as Rpc).rpc(fn, args);

export interface TenantRow {
  id: string; slug: string; name: string; brandName: string; brandPrimary: string; supportEmail: string | null;
  plan: string; status: "active" | "suspended" | "archived"; primaryOwnerId: string | null; createdAt: string; isDemo: boolean;
}
export interface OrgPolicy {
  tenantId: string; allowCustomRoles: boolean; allowCustomObjects: boolean; allowApiKeys: boolean; allowWebhooks: boolean; allowByok: boolean;
  allowConnectors: string[] | null; allowedModules: string[] | null; maxSeats: number | null; maxWorkspaces: number | null; maxCustomFields: number | null;
  updatedAt: string | null; persisted: boolean;
}
export interface WorkspaceStatRow {
  tenantId: string; tenantName: string; tenantStatus: string; workspaceId: string; workspaceName: string; workspaceSlug: string;
  members: number; leadsTotal: number; leads30d: number; integrationsAttention: number; failedSyncs24h: number; lastActivityAt: string | null;
}
export interface SupportSessionRow {
  id: string; adminId: string; workspaceId: string; tenantId: string; reason: string; mode: "read_only" | "read_write";
  startedAt: string; expiresAt: string; endedAt: string | null; state: "active" | "ended" | "expired";
}
export type ConnectorMode = "disabled" | "sandbox" | "live";
export type ConnectorEnv = "production" | "staging" | "demo";
export type GateStatus = "needs_vendor_approval" | "needs_client_credentials" | "ready";
export interface ConnectorCell { mode: ConnectorMode; gate: GateStatus; note: string | null }
export interface ConnectorRow { id: string; name: string; category: string; gate: string; cells: Partial<Record<ConnectorEnv, ConnectorCell>> }

export const CONNECTOR_ENVS: ConnectorEnv[] = ["production", "staging", "demo"];
export const CONNECTOR_MODES: ConnectorMode[] = ["disabled", "sandbox", "live"];
export const GATES: GateStatus[] = ["needs_vendor_approval", "needs_client_credentials", "ready"];

const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" ? v : v == null ? null : Number(v));
const arr = (v: unknown): string[] | null => (Array.isArray(v) ? v.map(String) : null);
type R = Record<string, unknown>;

export function toTenant(r: R): TenantRow {
  const st = s(r.status);
  return {
    id: s(r.id), slug: s(r.slug), name: s(r.name), brandName: s(r.brand_name) || s(r.name), brandPrimary: s(r.brand_primary), supportEmail: (r.support_email as string | null) ?? null,
    plan: s(r.plan), status: st === "suspended" || st === "archived" ? st : "active", primaryOwnerId: (r.primary_owner_id as string | null) ?? null,
    createdAt: s(r.created_at), isDemo: r.is_demo === true,
  };
}
const TENANT_COLS = "id,slug,name,brand_name,brand_primary,support_email,plan,status,primary_owner_id,created_at,is_demo";

export async function listTenants(db: Db): Promise<TenantRow[]> {
  const { data, error } = await from(db, "tenants").select(TENANT_COLS).order("name");
  throwIfError(error);
  return ((data as R[] | null) ?? []).map(toTenant);
}
export async function getTenantBySlug(db: Db, slug: string): Promise<TenantRow | null> {
  const { data, error } = await from(db, "tenants").select(TENANT_COLS).eq("slug", slug).maybeSingle();
  throwIfError(error);
  return data ? toTenant(data as R) : null;
}

export async function workspaceStats(db: Db): Promise<WorkspaceStatRow[]> {
  const { data, error } = await rpc(db, "admin_workspace_stats");
  throwIfError(error);
  return ((data as R[] | null) ?? []).map((r) => ({
    tenantId: s(r.tenant_id), tenantName: s(r.tenant_name), tenantStatus: s(r.tenant_status), workspaceId: s(r.workspace_id), workspaceName: s(r.workspace_name),
    workspaceSlug: s(r.workspace_slug), members: n(r.members) ?? 0, leadsTotal: n(r.leads_total) ?? 0, leads30d: n(r.leads_30d) ?? 0,
    integrationsAttention: n(r.integrations_attention) ?? 0, failedSyncs24h: n(r.failed_syncs_24h) ?? 0, lastActivityAt: (r.last_activity_at as string | null) ?? null,
  }));
}

export const DEFAULT_POLICY = (tenantId: string): OrgPolicy => ({
  tenantId, allowCustomRoles: true, allowCustomObjects: true, allowApiKeys: true, allowWebhooks: true, allowByok: false,
  allowConnectors: null, allowedModules: null, maxSeats: null, maxWorkspaces: null, maxCustomFields: null, updatedAt: null, persisted: false,
});
export async function getPolicy(db: Db, tenantId: string): Promise<OrgPolicy> {
  const { data, error } = await from(db, "org_admin_policies").select("*").eq("tenant_id", tenantId).maybeSingle();
  throwIfError(error);
  if (!data) return DEFAULT_POLICY(tenantId);
  const r = data as R;
  return {
    tenantId, allowCustomRoles: r.allow_custom_roles !== false, allowCustomObjects: r.allow_custom_objects !== false, allowApiKeys: r.allow_api_keys !== false,
    allowWebhooks: r.allow_webhooks !== false, allowByok: r.allow_byok === true, allowConnectors: arr(r.allow_connectors), allowedModules: arr(r.allowed_modules),
    maxSeats: n(r.max_seats), maxWorkspaces: n(r.max_workspaces), maxCustomFields: n(r.max_custom_fields), updatedAt: (r.updated_at as string | null) ?? null, persisted: true,
  };
}
/** Writes only the keys present in `patch`; the RPC (super_admin only, reason >= 8) audits the change. */
export async function setPolicy(db: Db, tenantId: string, patch: Record<string, unknown>, reason: string): Promise<void> {
  const { error } = await rpc(db, "admin_set_org_admin_policy", { p_tenant: tenantId, p_policy: patch, p_reason: reason });
  throwIfError(error);
}

export async function setTenantStatus(db: Db, tenantId: string, status: "active" | "suspended"): Promise<void> {
  const { error } = await rpc(db, "admin_set_tenant_status", { p_tenant: tenantId, p_status: status });
  throwIfError(error);
}
export async function createTenant(db: Db, a: { name: string; slug: string; branding: Record<string, unknown>; ownerEmail: string; workspaceName: string }): Promise<{ tenantId: string; workspaceId: string }> {
  const { data, error } = await rpc(db, "admin_create_tenant", { p_name: a.name, p_slug: a.slug, p_branding: a.branding, p_owner_email: a.ownerEmail, p_workspace_name: a.workspaceName });
  const m = mapPgError(error);
  if (m) throw m;
  const r = (data ?? {}) as R;
  return { tenantId: s(r.tenant_id), workspaceId: s(r.workspace_id) };
}
export async function createWorkspace(db: Db, tenantId: string, name: string, region: string | null): Promise<string> {
  const { data, error } = await rpc(db, "create_workspace", { p_tenant: tenantId, p_name: name, p_region_label: region });
  throwIfError(error);
  return s(data);
}
/** Platform admins may seat only the OWNER of a workspace that has none (invite_member enforces it). */
export async function seatOwner(db: Db, workspaceId: string, email: string): Promise<void> {
  const { error } = await rpc(db, "invite_member", { p_ws: workspaceId, p_email: email, p_role: "owner" });
  throwIfError(error);
}

export function sessionState(r: { endedAt: string | null; expiresAt: string }, now = Date.now()): SupportSessionRow["state"] {
  if (r.endedAt) return "ended";
  return Date.parse(r.expiresAt) > now ? "active" : "expired";
}
export async function listSupportSessions(db: Db, limit = 100): Promise<SupportSessionRow[]> {
  const { data, error } = await from(db, "support_sessions").select("id,admin_id,workspace_id,tenant_id,reason,mode,started_at,expires_at,ended_at").order("started_at", { ascending: false }).limit(limit);
  throwIfError(error);
  return ((data as R[] | null) ?? []).map((r) => {
    const base = { id: s(r.id), adminId: s(r.admin_id), workspaceId: s(r.workspace_id), tenantId: s(r.tenant_id), reason: s(r.reason), mode: (r.mode === "read_write" ? "read_write" : "read_only") as SupportSessionRow["mode"], startedAt: s(r.started_at), expiresAt: s(r.expires_at), endedAt: (r.ended_at as string | null) ?? null };
    return { ...base, state: sessionState(base) };
  });
}
/** Starts the session (one open session per admin; 15/30/60 minutes; DB enforces 20+ char reason and the 60 minute cap). */
export async function startSupportSession(db: Db, a: { workspaceId: string; reason: string; mode: "read_only" | "read_write"; minutes: 15 | 30 | 60 }): Promise<string> {
  const { data, error } = await rpc(db, "start_support_session", { p_workspace_id: a.workspaceId, p_reason: a.reason, p_mode: a.mode, p_minutes: a.minutes });
  throwIfError(error);
  return s(data);
}
export async function endSupportSession(db: Db, workspaceId: string): Promise<number> {
  const { data, error } = await rpc(db, "end_support_session", { p_workspace_id: workspaceId });
  throwIfError(error);
  return Number(data ?? 0);
}

export async function listConnectorMatrix(db: Db): Promise<ConnectorRow[]> {
  const [cat, av] = await Promise.all([
    from(db, "connector_catalog").select("id,name,category,gate").order("name"),
    from(db, "connector_availability").select("connector_id,env,mode,gate_status,note"),
  ]);
  throwIfError(cat.error); throwIfError(av.error);
  const cells = new Map<string, Partial<Record<ConnectorEnv, ConnectorCell>>>();
  for (const r of (av.data as R[] | null) ?? []) {
    const env = s(r.env) as ConnectorEnv;
    if (!CONNECTOR_ENVS.includes(env)) continue;
    const m = cells.get(s(r.connector_id)) ?? {};
    m[env] = { mode: CONNECTOR_MODES.includes(r.mode as ConnectorMode) ? (r.mode as ConnectorMode) : "disabled", gate: GATES.includes(r.gate_status as GateStatus) ? (r.gate_status as GateStatus) : "needs_vendor_approval", note: (r.note as string | null) ?? null };
    cells.set(s(r.connector_id), m);
  }
  return ((cat.data as R[] | null) ?? []).map((r) => ({ id: s(r.id), name: s(r.name), category: s(r.category), gate: s(r.gate), cells: cells.get(s(r.id)) ?? {} }));
}
/** RLS: write allowed to platform super_admin only. */
export async function setConnectorCell(db: Db, a: { connectorId: string; env: ConnectorEnv; mode: ConnectorMode; gate: GateStatus; note: string | null }): Promise<void> {
  const q = from(db, "connector_availability") as unknown as { upsert(v: R, o: R): PromiseLike<{ error: PgErr }> };
  const { error } = await q.upsert({ connector_id: a.connectorId, env: a.env, mode: a.mode, gate_status: a.gate, note: a.note }, { onConflict: "connector_id,env" });
  throwIfError(error);
}

export interface PlatformAdminDbRow { userId: string; role: string; active: boolean; createdAt: string }
export async function listPlatformAdmins(db: Db): Promise<PlatformAdminDbRow[]> {
  const { data, error } = await from(db, "platform_admins").select("user_id,platform_role,is_active,created_at").order("created_at");
  throwIfError(error);
  return ((data as R[] | null) ?? []).map((r) => ({ userId: s(r.user_id), role: s(r.platform_role), active: r.is_active !== false, createdAt: s(r.created_at) }));
}
