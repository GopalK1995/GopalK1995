import Link from "next/link";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { requireActive } from "@/lib/auth/server";
import { can } from "@/lib/authz";
import { loadPrincipal } from "@/lib/authz/load";
import { getLocale } from "@/i18n/server";
import { ot, otAll } from "@/lib/layouts/strings";
import { tenantOfWorkspace } from "@/lib/metadata/repo";
import { demoObject } from "../../o/_lib/demo";
import { ObjectsView, type ObjectRowView } from "./_components/objects-view";
import { customObjectsAllowed, listCustomObjects, recordCounts, type AdminObject } from "./_lib/repo";

export const metadata = { title: "Custom objects" };

const rowOf = (o: AdminObject, records: number): ObjectRowView => ({
  key: o.key, id: o.id, rev: o.rev, icon: o.icon, enabled: o.isEnabled, records,
  one: { en: o.label.en.one, ta: o.label.ta?.one ?? "" }, many: { en: o.label.en.many, ta: o.label.ta?.many ?? "" },
});

export default async function ObjectsSettingsPage() {
  const { session, active } = await requireActive();
  const locale = (await getLocale()) === "ta" ? "ta" : "en";
  const header = <PageHeader title={ot("objectsPageTitle", {}, locale)} sub={ot("objectsPageSub", {}, locale)} />;
  const principal = await loadPrincipal();
  if (!can(principal, "objects.manage")) {
    return <>{header}<EmptyState title={ot("objDeniedTitle", {}, locale)} body={active.support ? ot("objDeniedSupport", {}, locale) : ot("objDeniedBody", {}, locale)} /></>;
  }
  try {
    if (session.demo) {
      const o = demoObject();
      const row = rowOf({ ...o, rev: "demo", position: 1 }, 4);
      return <>{header}<ObjectsView demo strings={otAll(locale)} objects={[row]} allowed /></>;
    }
    const tenantId = await tenantOfWorkspace(active.ws.uuid);
    const [objects, allowed] = await Promise.all([listCustomObjects(tenantId), customObjectsAllowed(tenantId)]);
    const counts = await recordCounts(objects.map((o) => o.id)).catch(() => ({} as Record<string, number>));
    return <>{header}<ObjectsView demo={false} strings={otAll(locale)} objects={objects.map((o) => rowOf(o, counts[o.id] ?? 0))} allowed={allowed} /></>;
  } catch {
    return <>{header}<ErrorState source={ot("objectsLoadErrorSource", {}, locale)} message={ot("loadErrorBody", {}, locale)} retry={<Link href="/settings/objects"><Button>{ot("retry", {}, locale)}</Button></Link>} /></>;
  }
}
