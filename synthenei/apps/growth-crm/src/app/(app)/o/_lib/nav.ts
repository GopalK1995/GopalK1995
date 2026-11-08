// Sidebar entries for enabled custom objects, loaded in the app layout. Only objects the viewer may read are returned (catalogue
// check obj:<key>.read, never a role name). A failure returns [] so a metadata problem can never take the whole shell down.
import "server-only";
import { requireActive } from "@/lib/auth/server";
import { can } from "@/lib/authz";
import { loadPrincipal } from "@/lib/authz/load";
import { getLocale } from "@/i18n/server";
import { listObjectTypes, tenantOfWorkspace } from "@/lib/metadata/repo";
import { safeIcon } from "@/lib/layouts/icons";
import type { NavObject } from "@/components/shell/nav";
import { demoAccess, demoObject } from "./demo";
import { objPerm, objType } from "./ctx";

export function navLabelOf(o: { label: { en: { one: string; many: string }; ta?: { one: string; many: string } } }, locale: "en" | "ta"): string {
  return ((locale === "ta" ? o.label.ta?.many : undefined) ?? o.label.en.many);
}

export async function loadNavObjects(): Promise<NavObject[]> {
  try {
    const { session, active } = await requireActive();
    const locale = (await getLocale()) === "ta" ? "ta" : "en";
    if (session.demo) {
      const o = demoObject();
      return demoAccess(active.role).read ? [{ key: o.key, label: navLabelOf(o, locale), icon: safeIcon(o.icon) }] : [];
    }
    const principal = await loadPrincipal();
    const types = (await listObjectTypes(await tenantOfWorkspace(active.ws.uuid))).filter((o) => o.kind === "custom" && o.isEnabled);
    return types
      .filter((o) => can(principal, objPerm(o.key, "read"), { type: objType(o.key), workspaceId: active.ws.id }))
      .map((o) => ({ key: o.key, label: navLabelOf(o, locale), icon: safeIcon(o.icon) }));
  } catch (e) {
    console.error("[objects] nav entries failed", e);
    return [];
  }
}
