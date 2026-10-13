// Resolve the active workspace + role for a request. Edge-safe (used by middleware and server components).
import type { Role } from "../data/types";
import { tenantOf, workspaceById, type Tenant, type Workspace } from "../tenancy";
import type { Session, SupportSession } from "./session";

export interface Active { ws: Workspace; tenant: Tenant; role: Role; support: SupportSession | null }

/** Bad or foreign ws cookie falls back to the first (last-used) membership. Platform admins only get a workspace
 *  through a live support session: read_only acts as Viewer, read_write as Owner, in that one workspace. */
export function resolveActive(session: Session, wsCookie: string | undefined, support: SupportSession | null): Active | null {
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
