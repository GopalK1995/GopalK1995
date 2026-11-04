// Which layout applies to a viewer. Most specific wins:
//   1. this workspace + the viewer's role   2. org-wide + the viewer's role   3. this workspace (all roles)   4. org-wide (all roles)
// then the generated default (spec.ts). Pure.
import type { LayoutKind } from "./spec";

export interface LayoutRow {
  id: string; objectTypeId: string; kind: LayoutKind; workspaceId: string | null; roleId: string | null;
  spec: unknown; version: number; updatedAt?: string | null;
}
export type LayoutScope = "workspace_role" | "org_role" | "workspace" | "org";

export function scopeOf(r: Pick<LayoutRow, "workspaceId" | "roleId">): LayoutScope {
  return r.workspaceId ? (r.roleId ? "workspace_role" : "workspace") : r.roleId ? "org_role" : "org";
}
const RANK: Record<LayoutScope, number> = { workspace_role: 4, org_role: 3, workspace: 2, org: 1 };

export function pickLayout(rows: LayoutRow[], q: { objectTypeId: string; kind: LayoutKind; workspaceId: string; roleIds: string[] }): LayoutRow | null {
  let best: LayoutRow | null = null;
  for (const r of rows) {
    if (r.objectTypeId !== q.objectTypeId || r.kind !== q.kind) continue;
    if (r.workspaceId && r.workspaceId !== q.workspaceId) continue;
    if (r.roleId && !q.roleIds.includes(r.roleId)) continue;
    if (!best || RANK[scopeOf(r)] > RANK[scopeOf(best)]) best = r;
  }
  return best;
}
