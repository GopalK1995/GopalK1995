// The layout that applies to the signed-in viewer for one object and kind: most specific scope wins (workspace+role, org+role,
// workspace, org), then the generated default. A layout problem never blocks a page: any failure falls back to the default.
import "server-only";
import { defaultSpec, normalizeSpec, type DetailSpec, type LayoutKind, type ListSpec } from "@/lib/layouts/spec";
import { pickLayout, scopeOf, type LayoutScope } from "@/lib/layouts/resolve";
import { listLayouts, listRoles, roleIdsFor } from "@/lib/layouts/repo";
import { ot } from "@/lib/layouts/strings";
import type { ObjectCtx } from "./ctx";
import { demoLayouts } from "./demo";

export interface LoadedLayout<S> { spec: S; source: LayoutScope | "default" }

async function load(ctx: ObjectCtx, kind: LayoutKind): Promise<LoadedLayout<DetailSpec | ListSpec>> {
  const primary = ctx.object.primaryField;
  const untitled = ot("sectionDetails", {}, ctx.locale);
  try {
    const rows = ctx.demo ? demoLayouts() : await listLayouts(ctx.object.id);
    const roleIds = ctx.demo ? [ctx.roleKey ?? ""] : roleIdsFor(await listRoles(ctx.tenantId), ctx.roleKey);
    const row = pickLayout(rows, { objectTypeId: ctx.object.id, kind, workspaceId: ctx.wsUuid, roleIds });
    if (row) return { spec: normalizeSpec(kind, row.spec, ctx.fields, primary), source: scopeOf(row) };
  } catch (e) { console.error("[objects] layout load failed, using the default", e); }
  return { spec: defaultSpec(kind, ctx.fields, primary, untitled), source: "default" };
}
export const loadDetailLayout = (ctx: ObjectCtx) => load(ctx, "detail") as Promise<LoadedLayout<DetailSpec>>;
export const loadListLayout = (ctx: ObjectCtx) => load(ctx, "list") as Promise<LoadedLayout<ListSpec>>;
