import Link from "next/link";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { requireActive } from "@/lib/auth/server";
import { ROLE_LABEL, ROLES } from "@/lib/auth/roles";
import { can } from "@/lib/authz";
import { loadPrincipal } from "@/lib/authz/load";
import { getLocale } from "@/i18n/server";
import { listLayouts, listRoles, type RoleRef } from "@/lib/layouts/repo";
import { pickLayout, scopeOf, type LayoutRow } from "@/lib/layouts/resolve";
import { defaultSpec, normalizeSpec, type LayoutKind } from "@/lib/layouts/spec";
import { ot, otAll } from "@/lib/layouts/strings";
import { getObjectMeta } from "@/lib/metadata/meta";
import { tenantOfWorkspace } from "@/lib/metadata/repo";
import type { FieldDef, ObjectTypeDef } from "@/lib/metadata/types";
import { demoFields, demoLayouts, demoObject } from "../../o/_lib/demo";
import { LayoutEditor } from "./_components/layout-editor";
import { listCustomObjects } from "../objects/_lib/repo";

export const metadata = { title: "Layouts" };
type SP = { object?: string; kind?: string; scope?: string; role?: string };

export default async function LayoutsSettingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { session, active } = await requireActive();
  const locale = (await getLocale()) === "ta" ? "ta" : "en";
  const header = <PageHeader title={ot("layoutsPageTitle", {}, locale)} sub={ot("layoutsPageSub", {}, locale)} />;
  const principal = await loadPrincipal();
  if (!can(principal, "layouts.manage")) {
    return <>{header}<EmptyState title={ot("layoutsDeniedTitle", {}, locale)} body={active.support ? ot("layoutsDeniedSupport", {}, locale) : ot("layoutsDeniedBody", {}, locale)} /></>;
  }
  try {
    const sp = await searchParams;
    const demo = session.demo === true;
    let objects: Pick<ObjectTypeDef, "key" | "id" | "label" | "primaryField">[]; let roles: RoleRef[];
    const metaOf = async (key: string): Promise<{ fields: FieldDef[]; object: Pick<ObjectTypeDef, "id" | "primaryField"> } | null> => {
      if (demo) { const o = demoObject(); return key === o.key ? { fields: demoFields(), object: o } : null; }
      const m = await getObjectMeta(active.ws.uuid, key).catch(() => null);
      return m && m.object.kind === "custom" ? { fields: m.fields, object: m.object } : null;
    };
    if (demo) {
      objects = [demoObject()];
      roles = ROLES.map((r) => ({ id: r, key: r, name: ROLE_LABEL[r], system: true }));
    } else {
      const tenantId = await tenantOfWorkspace(active.ws.uuid);
      objects = (await listCustomObjects(tenantId)).filter((o) => o.isEnabled);
      roles = await listRoles(tenantId);
    }
    if (!objects.length) return <>{header}<EmptyState title={ot("layoutsNoObjectsTitle", {}, locale)} body={ot("layoutsNoObjectsBody", {}, locale)} action={<Link href="/settings/objects"><Button variant="primary" size="sm">{ot("linkObjects", {}, locale)}</Button></Link>} /></>;

    const current = objects.find((o) => o.key === sp.object) ?? objects[0];
    const meta = await metaOf(current.key);
    if (!meta) return <>{header}<EmptyState title={ot("layoutsNoObjectsTitle", {}, locale)} body={ot("layoutsNoObjectsBody", {}, locale)} /></>;
    const rows: LayoutRow[] = demo ? demoLayouts() : await listLayouts(meta.object.id);
    const kind: LayoutKind = sp.kind === "list" ? "list" : "detail";
    const scope = sp.scope === "workspace" ? "workspace" : "org";
    const roleId = roles.some((r) => r.id === sp.role) ? sp.role! : null;
    const wsId = active.ws.uuid;
    const exact = rows.find((r) => r.kind === kind && r.objectTypeId === meta.object.id && (scope === "workspace" ? r.workspaceId === wsId : r.workspaceId === null) && r.roleId === roleId) ?? null;
    const inherited = exact ? null : pickLayout(rows, { objectTypeId: meta.object.id, kind, workspaceId: wsId, roleIds: roleId ? [roleId] : [] });
    const initial = normalizeSpec(kind, (exact ?? inherited)?.spec, meta.fields, meta.object.primaryField);
    const spec = exact || inherited ? initial : defaultSpec(kind, meta.fields, meta.object.primaryField, ot("sectionDetails", {}, locale));
    const live = meta.fields.filter((f) => !f.archivedAt).sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
    const nameOfRole = (id: string | null) => (id ? roles.find((r) => r.id === id)?.name ?? id : null);
    return (
      <>
        {header}
        <LayoutEditor
          key={`${current.key}-${kind}-${scope}-${roleId ?? "all"}-${exact?.version ?? 0}`}
          demo={demo} locale={locale} strings={otAll(locale)}
          objects={objects.map((o) => ({ key: o.key, label: (locale === "ta" && o.label.ta?.many) || o.label.en.many }))}
          objectKey={current.key} kind={kind} scope={scope} roleId={roleId} roles={roles.map((r) => ({ id: r.id, name: r.name }))}
          fields={live.map((f) => ({ key: f.key, label: (locale === "ta" && f.label.ta) || f.label.en, type: f.type }))} primaryKey={meta.object.primaryField}
          initial={spec} version={exact?.version ?? 0} hasOverride={!!exact}
          inheritedFrom={inherited ? scopeOf(inherited) : null}
          overrides={rows.map((r) => ({ kind: r.kind, scope: r.workspaceId ? "workspace" as const : "org" as const, roleId: r.roleId, roleName: nameOfRole(r.roleId) }))}
        />
      </>
    );
  } catch (e) {
    console.error("[layouts] page failed", e);
    return <>{header}<ErrorState source={ot("layoutsLoadErrorSource", {}, locale)} message={ot("loadErrorBody", {}, locale)} retry={<Link href="/settings/layouts"><Button>{ot("retry", {}, locale)}</Button></Link>} /></>;
  }
}
