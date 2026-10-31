// Server-side loader for /settings/api-keys: one view model for demo and real sessions.
import { requireActive } from "@/lib/auth/server";
import { loadPrincipal } from "@/lib/authz/load";
import { can } from "@/lib/authz/engine";
import { dbForRequest } from "@/lib/db/client";
import { listApiKeys } from "@/lib/api/key-admin";
import { from } from "@/lib/db/query";
import { ROLES } from "@/lib/auth/roles";
import { checkRoleAssignment, type BaseRole } from "../../roles/_lib/guards";

export interface KeyView {
  id: string; name: string; prefix: string; env: "live" | "test"; scopes: string[]; roleLabel: string;
  lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string;
}
export type KeysResult =
  | { status: "ok"; demo: boolean; keys: KeyView[]; wsName: string; creatableRoles: string[] }
  | { status: "denied"; reason: "support" | "role"; roleLabel: string }
  | { status: "error" };

const DEMO_KEYS: KeyView[] = [
  { id: "demo-1", name: "Zapier lead intake", prefix: "Ab3dE9fG", env: "live", scopes: ["leads:write", "contacts:read"], roleLabel: "Sales Rep", lastUsedAt: "2026-10-30T09:12:00.000Z", expiresAt: null, revokedAt: null, createdAt: "2026-09-12T10:00:00.000Z" },
  { id: "demo-2", name: "Reporting export", prefix: "Qw8rT2yU", env: "live", scopes: ["leads:read", "deals:read", "campaigns:read"], roleLabel: "Viewer", lastUsedAt: null, expiresAt: "2027-01-15T00:00:00.000Z", revokedAt: null, createdAt: "2026-10-02T10:00:00.000Z" },
];

export async function loadKeys(): Promise<KeysResult> {
  const { session, active } = await requireActive();
  if (active.support) return { status: "denied", reason: "support", roleLabel: active.role };
  const demo = session.demo === true;
  const p = await loadPrincipal();
  // The demo fixture roles come from the legacy matrix, which has no api_keys.manage: owner-only integrations.manage stands in.
  const allowed = demo ? can(p, "integrations.manage") : can(p, "api_keys.manage");
  if (!allowed) return { status: "denied", reason: "role", roleLabel: active.role };
  const actor = { uid: session.uid, baseRole: active.role as BaseRole, held: p.grants };
  const creatableRoles = ROLES.filter((r) => checkRoleAssignment(actor, { baseRole: r as BaseRole, custom: false }).ok);
  if (demo) return { status: "ok", demo, keys: DEMO_KEYS, wsName: active.ws.name, creatableRoles };
  try {
    const db = await dbForRequest();
    const rows = await listApiKeys(db, active.ws.uuid);
    const ids = [...new Set(rows.map((k) => k.roleId).filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (ids.length) {
      const r = await from(db, "roles").select("id,name").in("id", ids);
      for (const x of (r.data as { id: string; name: string }[] | null) ?? []) names.set(x.id, x.name);
    }
    const keys = rows.map((k) => ({
      id: k.id, name: k.name, prefix: k.prefix, env: k.env, scopes: k.scopes, roleLabel: (k.roleId && names.get(k.roleId)) || "", lastUsedAt: k.lastUsedAt, expiresAt: k.expiresAt, revokedAt: k.revokedAt, createdAt: k.createdAt,
    }));
    return { status: "ok", demo, keys, wsName: active.ws.name, creatableRoles };
  } catch {
    return { status: "error" };
  }
}
