// The custom-fields section for a system record page (lead, account, deal, contact): reads the record's version and values
// (DB for real sessions, labelled examples for demo), applies the viewer's detail layout when one exists, then renders <CustomFields/>.
// A failure to load the record or the layout never breaks the host page: no record means no section, no layout means the default order.
import "server-only";
import { requireActive } from "@/lib/auth/server";
import { loadPrincipal } from "@/lib/authz/load";
import { getLocale } from "@/i18n/server";
import { loadDetailLayout } from "@/app/(app)/o/_lib/layout-load";
import { getObjectMeta } from "@/lib/metadata/meta";
import { loadRecordCustom } from "@/lib/metadata/record-custom";
import { tenantOfWorkspace } from "@/lib/metadata/repo";
import type { DetailSpec } from "@/lib/layouts/spec";
import { CustomFields } from "./custom-fields";

async function layoutFor(object: string): Promise<DetailSpec | null> {
  try {
    const { session, active } = await requireActive();
    const [meta, principal] = await Promise.all([getObjectMeta(active.ws.uuid, object), loadPrincipal()]);
    const demo = session.demo === true;
    const locale = (await getLocale()) === "ta" ? "ta" : "en";
    const l = await loadDetailLayout({ demo, locale, object: meta.object, fields: meta.fields, wsUuid: active.ws.uuid, roleKey: principal.roleKey ?? active.role, tenantId: demo ? "" : await tenantOfWorkspace(active.ws.uuid) });
    return l.source === "default" ? null : l.spec;
  } catch (e) { console.error("[record fields] layout failed, using the default order", e); return null; }
}

export async function RecordCustomFields({ object, id, ownerId, assigneeId, revalidate, title }: {
  object: string; id: string; ownerId?: string | null; assigneeId?: string | null; revalidate: string; title?: string;
}) {
  let record;
  try { record = await loadRecordCustom(object, id, { ownerId, assigneeId }); } catch (e) { console.error("[record fields] load failed", e); return null; }
  if (!record) return null;
  return <CustomFields object={object} record={record} layout={await layoutFor(object)} revalidate={revalidate} title={title} />;
}
