// Resolve the active workspace + role for a request. Edge-safe (used by middleware and server components).
import type { Role } from "../data/types";
import { tenantOf, workspaceById, type ActiveOption, type Tenant, type Workspace } from "../tenancy";
import type { Session, SupportSession } from "./session";

export interface Active { ws: Workspace; tenant: Tenant; role: Role; support: SupportSession | null;
  /** Real sessions: every workspace the caller may enter, from my_workspaces() (switcher list). Absent in demo. */ options?: ActiveOption[] }

/** Edge-safe routing hint (no DB): which workspace and role the cookies point at. Real sessions are re-checked in requireActive(). */
export interface ActiveHint { wsId: string; role: Role; /** Demo fixture tenant id; absent for real sessions. */ demoTenantId?: string }

export function resolveHint(session: Session, wsCookie: string | undefined, support: SupportSession | null): ActiveHint | null {
  if (session.platformAdmin) {
    if (!support) return null;
    if (session.demo && !(workspaceById(support.ws) && tenantOf(support.ws))) return null;
    return { wsId: support.ws, role: support.mode === "read_write" ? "owner" : "viewer", demoTenantId: session.demo ? tenantOf(support.ws)?.id : undefined };
  }
  const m = session.memberships.find((x) => x.ws === wsCookie) ?? session.memberships[0];
  if (!m) return null;
  if (!session.demo) return { wsId: m.ws, role: m.role };
  const t = tenantOf(m.ws);
  return workspaceById(m.ws) && t ? { wsId: m.ws, role: m.role, demoTenantId: t.id } : null;
}

/** Bad or foreign ws cookie falls back to the first (last-used) membership. Platform admins only get a workspace
 *  through a live support session: read_only acts as Viewer, read_write as Owner, in that one workspace.
 *  `options` (from my_workspaces()) is used for real sessions; without it the demo fixture is used. */
export function resolveActive(session: Session, wsCookie: string | undefined, support: SupportSession | null, options?: ActiveOption[] | null): Active | null {
  if (options && !session.demo) {
    if (session.platformAdmin) {
      if (!support) return null;
      const o = options.find((x) => x.viaSupport && x.ws.id === support.ws);
      return o ? { ws: o.ws, tenant: o.tenant, role: support.mode === "read_write" ? "owner" : "viewer", support, options } : null;
    }
    const own = options.filter((x) => !x.viaSupport);
    const hinted = session.memberships.map((m) => m.ws);
    const o = own.find((x) => x.ws.id === wsCookie) ?? own.find((x) => x.ws.id === hinted[0]) ?? own[0];
    return o ? { ws: o.ws, tenant: o.tenant, role: o.role, support: null, options: own } : null;
  }
  if (session.platformAdmin) {
    if (!support) return null;
    const ws = workspaceById(support.ws), tenant = tenantOf(support.ws);
    return ws && tenant ? { ws, tenant, role: support.mode === "read_write" ? "owner" : "viewer", support } : null;
  }
  const m = session.memberships.find((x) => x.ws === wsCookie) ?? session.memberships[0];
  if (!m) return null;
  const ws = workspaceById(m.ws), tenant = tenantOf(m.ws);
  return ws && tenant ? { ws, tenant, role: m.role, support: null } : null;
}
