// Platform-admin read model: metadata and aggregate counts only. No business rows (no lead names, no contacts)
// ever leave this module. Demo: counts are computed from the synthetic datasets. Real: the BACKEND aggregate RPC
// (admin_workspace_stats, gated by is_platform_admin()) replaces workspaceStats(); platform tables replace the rest.
import { MEMBERSHIPS, TENANTS, USERS, WORKSPACES, type Tenant, type Workspace } from "@/lib/tenancy";
import { datasetFor } from "@/lib/data/mock/generate-index";
import { NOW_ISO } from "@/lib/data/mock/seed";
import { supportEvents, type SupportEvent } from "@/lib/support-log";
import type { Role } from "@/lib/data/types";
import { SUPPORT_BLOCKED } from "@/lib/auth/roles";

export const ADMIN_NOW = NOW_ISO;
const NOW = new Date(NOW_ISO).getTime();
const DAY = 86400e3;

export const wsLabel = (ws: Workspace) => `${TENANTS.find((t) => t.id === ws.tenantId)?.name.replace(" (demo)", "") ?? ws.tenantId} · ${ws.name}`;
export const wsLabelById = (id: string) => { const w = WORKSPACES.find((x) => x.id === id); return w ? wsLabel(w) : id; };
/** Personal data in the console is masked: first letter + domain. */
export const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, "$1•••$2");

export interface WorkspaceStats {
  ws: Workspace; members: number; leadsTotal: number; leads30d: number; integrationsAttention: number; failedSyncs24h: number; lastActivityAt: string | null; unavailable?: boolean;
}
const statsCache = new Map<string, WorkspaceStats>();
export function workspaceStats(ws: Workspace): WorkspaceStats {
  const hit = statsCache.get(ws.id);
  if (hit) return hit;
  let d: ReturnType<typeof datasetFor>;
  try { d = datasetFor(ws.dataset); } catch (e) {
    // A broken dataset must not take the console down; the row shows as unavailable (and is not cached).
    console.error(`admin: dataset ${ws.dataset} unavailable`, e);
    return { ws, members: MEMBERSHIPS.filter((m) => m.workspaceId === ws.id).length, leadsTotal: 0, leads30d: 0, integrationsAttention: 0, failedSyncs24h: 0, lastActivityAt: null, unavailable: true };
  }
  const leads30d = d.leads.filter((l) => NOW - new Date(l.createdAt).getTime() <= 30 * DAY).length;
  const last = d.leads.reduce<string | null>((m, l) => (!m || l.lastTouchAt > m ? l.lastTouchAt : m), null);
  const s: WorkspaceStats = {
    ws,
    members: MEMBERSHIPS.filter((m) => m.workspaceId === ws.id).length,
    leadsTotal: d.leads.length,
    leads30d,
    integrationsAttention: d.integrations.filter((i) => i.status === "error" || i.status === "needs_attention").length,
    failedSyncs24h: d.syncRuns.filter((r) => r.status === "failed" && NOW - new Date(r.startedAt).getTime() <= DAY).length,
    lastActivityAt: last && last <= NOW_ISO ? last : NOW_ISO,
  };
  statsCache.set(ws.id, s);
  return s;
}

export interface TenantSummary {
  tenant: Tenant; workspaces: WorkspaceStats[]; seatsUsed: number; leads30d: number; owner: string; lastActivityAt: string | null;
}
export function tenantSummary(t: Tenant): TenantSummary {
  const workspaces = WORKSPACES.filter((w) => w.tenantId === t.id).map(workspaceStats);
  const ids = new Set(workspaces.map((w) => w.ws.id));
  const seatsUsed = new Set(MEMBERSHIPS.filter((m) => ids.has(m.workspaceId)).map((m) => m.userId)).size;
  const lastActivityAt = workspaces.map((w) => w.lastActivityAt).filter(Boolean).sort().at(-1) ?? null;
  return { tenant: t, workspaces, seatsUsed, leads30d: workspaces.reduce((a, w) => a + w.leads30d, 0), owner: USERS.find((u) => u.id === t.primaryOwnerId)?.name ?? "—", lastActivityAt };
}
export const allTenants = () => TENANTS.map(tenantSummary);

/** Usage numbers that are not in the datasets (AI calls, storage). Fixed sample values per tenant. */
export const USAGE: Record<string, { aiCalls: number; aiCap: number; storageMb: number; storageCapMb: number }> = {
  lawsome: { aiCalls: 0, aiCap: 2000, storageMb: 184, storageCapMb: 5120 },
  "kaveri-demo": { aiCalls: 0, aiCap: 250, storageMb: 12, storageCapMb: 1024 },
};

// ---- users -------------------------------------------------------------------------------------------------
export interface AdminUser {
  id: string; name: string; email: string; status: "active" | "invited" | "deactivated"; lastSignIn: string | null; mfa: boolean;
  memberships: { wsId: string; tenantId: string; label: string; role: Role }[];
}
/** Platform admins are separate identities (a trigger rejects a membership for a platform admin and vice versa). */
export interface PlatformAdminRow { id: string; name: string; email: string; status: "active" | "invited" | "revoked"; lastSignIn: string | null; mfa: boolean; addedAt: string; self?: boolean }

const MFA_ON = new Set(["u-meenakshi", "u-lavanya", "u-priya"]);
export function workspaceUsers(): AdminUser[] {
  return USERS.filter((u) => !u.platformAdmin).map((u) => ({
    id: u.id, name: u.name, email: u.email, status: u.status, lastSignIn: u.status === "invited" ? null : u.lastSignIn, mfa: MFA_ON.has(u.id),
    memberships: MEMBERSHIPS.filter((m) => m.userId === u.id).map((m) => {
      const w = WORKSPACES.find((x) => x.id === m.workspaceId)!;
      return { wsId: w.id, tenantId: w.tenantId, label: wsLabel(w), role: m.role };
    }),
  }));
}
export function platformAdmins(selfId: string): PlatformAdminRow[] {
  const rows: PlatformAdminRow[] = USERS.filter((u) => u.platformAdmin).map((u) => ({
    id: u.id, name: u.name, email: u.email, status: "active", lastSignIn: u.lastSignIn, mfa: true, addedAt: "2026-06-01", self: u.id === selfId,
  }));
  // Second operator so grant/revoke can be demonstrated on someone other than yourself.
  rows.push({ id: "pa-deepa", name: "Deepa Natarajan", email: "platform+deepa@synthan.example", status: "active", lastSignIn: "2026-10-10T06:20:00.000Z", mfa: true, addedAt: "2026-08-14" });
  return rows;
}

// ---- support sessions --------------------------------------------------------------------------------------
export interface SupportRow {
  id: string; admin: string; wsId: string; mode: string; reason: string; minutes: number; startedAt: string; endedAt: string | null;
  state: "active" | "ended" | "expired"; actions: number;
}
/** Pairs support_started with the next support_ended for the same workspace. */
export function supportSessions(live?: { ws: string; endsAt: number } | null): SupportRow[] {
  const ev = [...supportEvents()].sort((a, b) => a.at.localeCompare(b.at));
  const rows: SupportRow[] = [];
  ev.forEach((e: SupportEvent, i) => {
    if (e.action !== "support_started") return;
    const end = ev.slice(i + 1).find((x) => x.ws === e.ws);
    const endedAt = end?.action === "support_ended" ? end.at : null;
    const expiresAt = new Date(e.at).getTime() + (e.minutes ?? 30) * 60e3;
    const isLive = !endedAt && !!live && live.ws === e.ws && live.endsAt > Date.now() && !ev.slice(i + 1).some((x) => x.ws === e.ws);
    rows.push({
      id: e.id, admin: e.admin, wsId: e.ws, mode: e.mode ?? "read_only", reason: e.reason ?? "", minutes: e.minutes ?? 30, startedAt: e.at,
      endedAt: endedAt ?? (isLive ? null : new Date(Math.min(expiresAt, Date.now())).toISOString()),
      state: isLive ? "active" : endedAt ? "ended" : "expired",
      actions: AUDIT_SEED.filter((a) => a.supportSessionId === e.id).length,
    });
  });
  return rows.reverse();
}

// ---- platform audit log ------------------------------------------------------------------------------------
export interface AuditRow {
  id: string; at: string; actor: string; actorKind: "platform_admin" | "member" | "system"; tenantId: string | null; wsId: string | null;
  action: string; target: string; supportSessionId?: string;
}
const AUDIT_SEED: AuditRow[] = [
  { id: "A-1042", at: "2026-10-13T03:40:00.000Z", actor: "Vikram Anand", actorKind: "platform_admin", tenantId: null, wsId: null, action: "platform_admin.signed_in", target: "MFA aal2 · 49.204.x.x" },
  { id: "A-1041", at: "2026-10-13T02:00:00.000Z", actor: "backup job", actorKind: "system", tenantId: null, wsId: null, action: "backup.logical_dump", target: "pg_dump ok · 41.8 MB" },
  { id: "A-1040", at: "2026-10-12T16:45:00.000Z", actor: "Lavanya Prakash", actorKind: "member", tenantId: "kaveri-demo", wsId: "kaveri-cbe", action: "member.invited", target: `${maskEmail("suresh@kaverilegal.example")} as Sales Rep` },
  { id: "A-1039", at: "2026-10-12T11:10:00.000Z", actor: "Sanjay Iyer", actorKind: "member", tenantId: "lawsome", wsId: "lawsome-tn", action: "csv_import.rows_rejected", target: "csv import #81 · 3 of 214 rows rejected (missing phone)" },
  { id: "A-1038", at: "2026-10-11T09:30:00.000Z", actor: "Meenakshi Sundaram", actorKind: "member", tenantId: "lawsome", wsId: "lawsome-kl", action: "member.role_changed", target: `${maskEmail("arun@lawsome.example")} · Sales Rep -> Viewer` },
  { id: "A-1037", at: "2026-10-09T09:12:00.000Z", actor: "Vikram Anand", actorKind: "platform_admin", tenantId: "lawsome", wsId: "lawsome-tn", action: "support.ended", target: "SE-2 · ended by admin", supportSessionId: "SE-2" },
  { id: "A-1036", at: "2026-10-09T09:02:00.000Z", actor: "Vikram Anand", actorKind: "platform_admin", tenantId: "lawsome", wsId: "lawsome-tn", action: "import_run.viewed", target: "csv import #77 · 2 rows rejected", supportSessionId: "SE-2" },
  { id: "A-1035", at: "2026-10-09T08:55:00.000Z", actor: "Vikram Anand", actorKind: "platform_admin", tenantId: "lawsome", wsId: "lawsome-tn", action: "integration.viewed", target: "linkedin · field map", supportSessionId: "SE-2" },
  { id: "A-1034", at: "2026-10-09T08:47:00.000Z", actor: "Vikram Anand", actorKind: "platform_admin", tenantId: "lawsome", wsId: "lawsome-tn", action: "support.started", target: "SE-2 · read-only · 30 min", supportSessionId: "SE-2" },
  { id: "A-1033", at: "2026-09-24T06:10:00.000Z", actor: "Vikram Anand", actorKind: "platform_admin", tenantId: "kaveri-demo", wsId: "kaveri-cbe", action: "pipeline_stages.viewed", target: "7 stages", supportSessionId: "SE-1" },
  { id: "A-1032", at: "2026-09-24T06:05:00.000Z", actor: "Vikram Anand", actorKind: "platform_admin", tenantId: "kaveri-demo", wsId: "kaveri-cbe", action: "support.started", target: "SE-1 · read-only · 15 min", supportSessionId: "SE-1" },
  { id: "A-1031", at: "2026-09-21T10:00:00.000Z", actor: "Vikram Anand", actorKind: "platform_admin", tenantId: "kaveri-demo", wsId: "kaveri-cbe", action: "tenant.created", target: `Kaveri LegalTech (demo) · owner ${maskEmail("lavanya@kaverilegal.example")}` },
  { id: "A-1030", at: "2026-09-08T07:30:00.000Z", actor: "Vikram Anand", actorKind: "platform_admin", tenantId: "lawsome", wsId: "lawsome-kl", action: "workspace.created", target: "LAWSOME · Kerala pilot" },
  { id: "A-1029", at: "2026-08-14T05:00:00.000Z", actor: "Vikram Anand", actorKind: "platform_admin", tenantId: null, wsId: null, action: "platform_admin.granted", target: maskEmail("platform+deepa@synthan.example") },
  { id: "A-1028", at: "2026-06-02T06:00:00.000Z", actor: "Vikram Anand", actorKind: "platform_admin", tenantId: "lawsome", wsId: "lawsome-tn", action: "tenant.created", target: `LAWSOME · owner ${maskEmail("meenakshi@lawsome.example")}` },
];
/** Seed rows plus support sessions started/ended in this server process (demo store). */
export function auditRows(): AuditRow[] {
  const seeded = new Set(["SE-1", "SE-2", "SE-3"]);
  const live: AuditRow[] = supportEvents().filter((e) => !seeded.has(e.id)).map((e) => ({
    id: `A-${e.id}`, at: e.at, actor: e.admin, actorKind: "platform_admin", tenantId: WORKSPACES.find((w) => w.id === e.ws)?.tenantId ?? null, wsId: e.ws,
    action: e.action === "support_started" ? "support.started" : "support.ended",
    target: e.action === "support_started" ? `${e.id} · ${e.mode === "read_write" ? "read-write" : "read-only"} · ${e.minutes} min` : `${e.id} · ended by admin`,
    supportSessionId: e.action === "support_started" ? e.id : undefined,
  }));
  return [...live, ...AUDIT_SEED].sort((a, b) => b.at.localeCompare(a.at));
}
export const ACTION_LABEL: Record<string, string> = {
  "platform_admin.signed_in": "Platform admin signed in", "platform_admin.granted": "Platform admin granted", "backup.logical_dump": "Nightly backup",
  "member.invited": "Member invited", "member.role_changed": "Role changed", "csv_import.rows_rejected": "CSV rows rejected", "support.started": "Support session started",
  "support.ended": "Support session ended", "import_run.viewed": "Import run viewed", "integration.viewed": "Integration viewed",
  "pipeline_stages.viewed": "Pipeline stages viewed", "tenant.created": "Tenant created", "workspace.created": "Workspace created",
};

/** Labels for SUPPORT_BLOCKED (@/lib/auth/roles): blocked in read_only and read_write support sessions. */
export const NEVER_LABEL: Record<(typeof SUPPORT_BLOCKED)[number], string> = {
  erase: "Delete or erase a lead (erase_lead, leads_delete)",
  exportCsv: "Export CSV",
  connectIntegrations: "Connect or disconnect an integration, or edit its secrets",
  aiToggle: "Turn AI features on or off",
  branding: "Change tenant branding",
  manageUsers: "Invite users, change roles or deactivate members",
  privacyRequests: "Process privacy requests (DPDP access, withdrawal, erasure)",
  createWorkspace: "Create or archive a workspace",
};
export const NEVER_LIST = SUPPORT_BLOCKED.map((k) => NEVER_LABEL[k]);

/** "Now" for relative times: the dataset clock, or the wall clock once live demo events are newer. */
export const adminNow = () => new Date(Math.max(Date.now(), NOW)).toISOString();
