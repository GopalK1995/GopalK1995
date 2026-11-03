import Link from "next/link";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { requireActive } from "@/lib/auth/server";
import { can } from "@/lib/authz";
import { loadPrincipal } from "@/lib/authz/load";
import { getLocale } from "@/i18n/server";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { objectNoun } from "@/lib/metadata/labels";
import { getEditableObjects, getObjectMeta } from "@/lib/metadata/meta";
import { fieldLimit, tenantOfWorkspace } from "@/lib/metadata/repo";
import { ft, ftAll } from "@/lib/metadata/strings";
import { vocabFor } from "@/lib/vertical";
import { FieldsView } from "./_components/fields-view";

export const metadata = { title: "Custom fields" };

export default async function FieldsSettingsPage({ searchParams }: { searchParams: Promise<{ object?: string }> }) {
  const { session, active } = await requireActive();
  const locale = (await getLocale()) === "ta" ? "ta" : "en";
  const vocab = vocabFor(active.tenant);
  const header = <PageHeader title={ft("pageTitle", {}, locale)} sub={ft("pageSub", {}, locale)} />;
  const principal = await loadPrincipal();
  if (!can(principal, "fields.manage")) {
    return <>{header}<EmptyState title={ft("deniedTitle", {}, locale)} body={active.support ? ft("deniedSupport", {}, locale) : ft("deniedBody", {}, locale)} /></>;
  }
  try {
    const sp = await searchParams;
    const { objects, demo } = await getEditableObjects(active.ws.uuid);
    const current = objects.find((o) => o.key === sp.object) ?? objects[0];
    if (!current) return <>{header}<EmptyState title={ft("noObjectsTitle", {}, locale)} body={ft("noObjectsBody", {}, locale)} /></>;
    const meta = await getObjectMeta(active.ws.uuid, current.key);
    const limit = demo || session.demo ? { max: null, used: meta.fields.filter((f) => !f.archivedAt).length } : await fieldLimit(await tenantOfWorkspace(active.ws.uuid));
    const nouns = Object.fromEntries(objects.map((o) => [o.key, objectNoun(vocab, o.key, o)]));
    return (
      <>
        {header}
        <FieldsView
          demo={demo} locale={locale} strings={ftAll(locale)} objects={objects.map((o) => ({ key: o.key, one: nouns[o.key].one, many: nouns[o.key].many, custom: o.kind === "custom" }))}
          objectKey={current.key} fields={meta.fields} limit={limit}
          roles={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))}
        />
      </>
    );
  } catch {
    return <>{header}<ErrorState source={ft("loadErrorSource", {}, locale)} message={ft("loadErrorBody", {}, locale)} retry={<Link href="/settings/fields"><Button>{ft("retry", {}, locale)}</Button></Link>} /></>;
  }
}
