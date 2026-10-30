// Page loaders: demo sessions get today's demo read model, real sessions get the database. Each loader returns a result
// instead of throwing so pages can draw error and partial states (the failing source is named).
import { dbForRequest, type Db } from "@/lib/db/client";
import type { Tenant, Workspace } from "@/lib/tenancy";
import { allTenants, type TenantSummary, type WorkspaceStats } from "../_components/data";
import * as repo from "./repo";

export type Loaded<T> = { ok: true; data: T; partial?: string } | { ok: false; error: string };
const msg = (e: unknown) => (e instanceof Error ? e.message : "unknown error") + ((e as { detail?: string })?.detail ? `: ${(e as { detail?: string }).detail}` : "");

export async function realDb(): Promise<Db | null> {
  try { return await dbForRequest(); } catch { return null; }
}

/** oklch(0.52 0.15 245) -> 245; anything else -> the platform hue. */
export const hueOf = (brandPrimary: string): number => {
  const m = /oklch\(\s*[\d.]+\s+[\d.]+\s+([\d.]+)/.exec(brandPrimary);
  return m ? Math.round(Number(m[1])) % 360 : 245;
};
const PLAN: Record<string, Tenant["plan"]> = { demo: "Pilot", starter: "Pilot", growth: "Growth", enterprise: "Scale" };

export function tenantFromRow(r: repo.TenantRow, seats: number | null): Tenant {
  return {
    id: r.slug, name: r.name, product: r.brandName, hue: hueOf(r.brandPrimary), monogram: (r.brandName.trim()[0] ?? "?").toUpperCase(),
    plan: PLAN[r.plan] ?? "Pilot", seats: seats ?? 0, primaryOwnerId: r.primaryOwnerId ?? "",
    status: r.status === "active" ? "active" : "suspended", createdAt: r.createdAt, supportEmail: r.supportEmail ?? "",
  };
}
export function wsFromStat(r: repo.WorkspaceStatRow, tenantSlug: string): WorkspaceStats {
  const ws: Workspace = { id: r.workspaceId, uuid: r.workspaceId, tenantId: tenantSlug, name: r.workspaceName, region: "", createdAt: "", dataset: "tn" };
  return { ws, members: r.members, leadsTotal: r.leadsTotal, leads30d: r.leads30d, integrationsAttention: r.integrationsAttention, failedSyncs24h: r.failedSyncs24h, lastActivityAt: r.lastActivityAt };
}
export function summariesFrom(tenants: repo.TenantRow[], stats: repo.WorkspaceStatRow[], seatCaps: Map<string, number | null>): TenantSummary[] {
  return tenants.map((t) => {
    const workspaces = stats.filter((w) => w.tenantId === t.id).map((w) => wsFromStat(w, t.slug));
    const last = workspaces.map((w) => w.lastActivityAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
    return { tenant: tenantFromRow(t, seatCaps.get(t.id) ?? null), workspaces, seatsUsed: workspaces.reduce((a, w) => a + w.members, 0), leads30d: workspaces.reduce((a, w) => a + w.leads30d, 0), owner: "—", lastActivityAt: last };
  });
}

export async function loadTenantSummaries(demo: boolean): Promise<Loaded<TenantSummary[]>> {
  if (demo) return { ok: true, data: allTenants() };
  const db = await realDb();
  if (!db) return { ok: false, error: "Supabase is not configured on this deployment." };
  let tenants: repo.TenantRow[];
  try { tenants = await repo.listTenants(db); } catch (e) { return { ok: false, error: msg(e) }; }
  try {
    const stats = await repo.workspaceStats(db);
    return { ok: true, data: summariesFrom(tenants, stats, new Map()) };
  } catch (e) {
    return { ok: true, data: summariesFrom(tenants, [], new Map()), partial: `Workspace counts could not be read (${msg(e)}).` };
  }
}

export async function loadTenantSummary(demo: boolean, slug: string): Promise<Loaded<{ summary: TenantSummary; policy: repo.OrgPolicy | null; policyError?: string } | null>> {
  if (demo) {
    const t = allTenants().find((x) => x.tenant.id === slug);
    return { ok: true, data: t ? { summary: t, policy: null } : null };
  }
  const db = await realDb();
  if (!db) return { ok: false, error: "Supabase is not configured on this deployment." };
  try {
    const row = await repo.getTenantBySlug(db, slug);
    if (!row) return { ok: true, data: null };
    let partial: string | undefined, stats: repo.WorkspaceStatRow[] = [], policy: repo.OrgPolicy | null = null, policyError: string | undefined;
    try { stats = await repo.workspaceStats(db); } catch (e) { partial = `Workspace counts could not be read (${msg(e)}).`; }
    try { policy = await repo.getPolicy(db, row.id); } catch (e) { policyError = msg(e); }
    const [summary] = summariesFrom([row], stats, new Map([[row.id, policy?.maxSeats ?? null]]));
    return { ok: true, data: { summary, policy, policyError }, partial };
  } catch (e) { return { ok: false, error: msg(e) }; }
}

const DEMO_MATRIX: repo.ConnectorRow[] = [
  { id: "csv", name: "CSV import", category: "data", gate: "none", cells: { production: { mode: "live", gate: "ready", note: null }, staging: { mode: "live", gate: "ready", note: null }, demo: { mode: "live", gate: "ready", note: null } } },
  { id: "whatsapp", name: "WhatsApp Business", category: "messaging", gate: "needs_vendor_approval", cells: { production: { mode: "disabled", gate: "needs_vendor_approval", note: null }, staging: { mode: "sandbox", gate: "needs_vendor_approval", note: null }, demo: { mode: "sandbox", gate: "ready", note: null } } },
  { id: "razorpay", name: "Razorpay", category: "payments", gate: "needs_client_credentials", cells: { production: { mode: "disabled", gate: "needs_client_credentials", note: null } } },
];
export async function loadConnectorMatrix(demo: boolean): Promise<Loaded<repo.ConnectorRow[]>> {
  if (demo) return { ok: true, data: DEMO_MATRIX };
  const db = await realDb();
  if (!db) return { ok: false, error: "Supabase is not configured on this deployment." };
  try { return { ok: true, data: await repo.listConnectorMatrix(db) }; } catch (e) { return { ok: false, error: msg(e) }; }
}

export interface SupportListRow { id: string; admin: string; wsLabel: string; wsId: string; mode: string; reason: string; startedAt: string; endedAt: string | null; state: "active" | "ended" | "expired" }
export interface WorkspaceOption { tenantId: string; tenantName: string; workspaces: { id: string; name: string }[] }
/** Real: sessions from support_sessions (own rows and all, RLS decides) + workspace options from admin_workspace_stats. */
export async function loadSupportReal(): Promise<Loaded<{ sessions: SupportListRow[]; options: WorkspaceOption[] }>> {
  const db = await realDb();
  if (!db) return { ok: false, error: "Supabase is not configured on this deployment." };
  try {
    const [sessions, stats] = await Promise.all([repo.listSupportSessions(db), repo.workspaceStats(db)]);
    const label = new Map(stats.map((w) => [w.workspaceId, `${w.tenantName} · ${w.workspaceName}`]));
    const byTenant = new Map<string, WorkspaceOption>();
    for (const w of stats) {
      const o = byTenant.get(w.tenantId) ?? { tenantId: w.tenantId, tenantName: w.tenantName, workspaces: [] };
      o.workspaces.push({ id: w.workspaceId, name: w.workspaceName });
      byTenant.set(w.tenantId, o);
    }
    return { ok: true, data: {
      sessions: sessions.map((r) => ({ id: r.id.slice(0, 8), admin: r.adminId.slice(0, 8), wsLabel: label.get(r.workspaceId) ?? r.workspaceId, wsId: r.workspaceId, mode: r.mode, reason: r.reason, startedAt: r.startedAt, endedAt: r.endedAt ?? (r.state === "expired" ? r.expiresAt : null), state: r.state })),
      options: [...byTenant.values()],
    } };
  } catch (e) { return { ok: false, error: msg(e) }; }
}
