// <CustomFields object="lead" record={...}/>: server component that loads the field definitions, applies the viewer's
// field permissions, strips everything they may not see, and hands the rest to the client panel. T040 mounts it on the
// lead, deal and account pages. Pass readOnly for a plain display (e.g. a hover card or print view).
import { ErrorState } from "@/components/ui/states";
import { requireActive } from "@/lib/auth/server";
import { can } from "@/lib/authz";
import { loadPrincipal } from "@/lib/authz/load";
import { getLocale } from "@/i18n/server";
import { DbError } from "@/lib/db/errors";
import { objectNoun } from "@/lib/metadata/labels";
import { getObjectMeta } from "@/lib/metadata/meta";
import { prepareCustomFields } from "@/lib/metadata/runtime";
import { writePermOf } from "@/lib/metadata/save";
import { ft } from "@/lib/metadata/strings";
import { authzTypeOf } from "@/lib/metadata/types";
import { vocabFor } from "@/lib/vertical";
import type { ObjectType } from "@/lib/authz";
import type { Option } from "@/components/ui/controls";
import { placeFields } from "@/lib/layouts/place";
import type { DetailSpec } from "@/lib/layouts/spec";
import { ot } from "@/lib/layouts/strings";
import { CustomFieldsPanel } from "./custom-fields-panel";

export interface CustomFieldsRecord {
  id: string; version: number; ownerId?: string | null; assigneeId?: string | null;
  /** The record's `custom` jsonb (or `data` for a custom object). Unmasked here; masked before it reaches the client. */
  custom: Record<string, unknown> | null | undefined;
}

export async function CustomFields({ object, record, readOnly = false, lookups, revalidate, title, layout }: {
  object: string; record: CustomFieldsRecord; readOnly?: boolean; lookups?: Record<string, Option[]>; revalidate?: string; title?: string;
  /** A resolved (non-default) detail layout for the viewer: groups and orders the fields, and hides fields it does not place. */
  layout?: DetailSpec | null;
}) {
  const { session, active } = await requireActive();
  const locale = (await getLocale()) === "ta" ? "ta" : "en";
  const noun = objectNoun(vocabFor(active.tenant), object).one;
  try {
    const [principal, meta] = await Promise.all([loadPrincipal(), getObjectMeta(active.ws.uuid, object)]);
    const ref = { type: authzTypeOf(object) as ObjectType, id: record.id, workspaceId: active.ws.id, ownerId: record.ownerId ?? null, assigneeId: record.assigneeId ?? null };
    const canWriteRecord = !readOnly && can(principal, writePermOf(object), ref);
    const prepared = prepareCustomFields({ defs: meta.fields, values: record.custom ?? {}, principal, objectKey: object, canWriteRecord });
    return (
      <CustomFieldsPanel
        objectKey={object} recordId={record.id} version={record.version} fields={layout ? placeFields(prepared.fields, layout, ot("sectionDetails", {}, locale)) : prepared.fields} values={prepared.values}
        hiddenCount={prepared.hiddenCount} locale={locale} demo={session.demo === true} noun={noun}
        canManage={can(principal, "fields.manage")} revalidate={revalidate} lookups={lookups} title={title}
      />
    );
  } catch (e) {
    if (e instanceof DbError && e.code === "not_found") return null;
    return <ErrorState source={ft("sectionTitle", {}, locale)} message={ft("loadErrorBody", { noun }, locale)} />;
  }
}

/** Read-only display of the same section. */
export function CustomFieldsDisplay(props: Omit<Parameters<typeof CustomFields>[0], "readOnly">) {
  return <CustomFields {...props} readOnly />;
}
