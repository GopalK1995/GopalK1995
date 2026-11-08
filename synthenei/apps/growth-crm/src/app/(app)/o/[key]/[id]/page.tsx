import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { CustomFieldsPanel } from "@/components/fields/custom-fields-panel";
import { RecordCollab } from "@/components/collab/record-collab";
import { MASK } from "@/lib/authz/engine";
import { requireActive } from "@/lib/auth/server";
import { ot, otAll } from "@/lib/layouts/strings";
import { objectNoun } from "@/lib/metadata/labels";
import { prepareCustomFields, type ClientField } from "@/lib/metadata/runtime";
import { vocabFor } from "@/lib/vertical";
import { objType, loadObjectCtx } from "../../_lib/ctx";
import { demoRecords } from "../../_lib/demo";
import { loadDetailLayout } from "../../_lib/layout-load";
import { displayTitle } from "../../_lib/query";
import { loadRelated } from "../../_lib/related";
import * as repo from "../../_lib/repo";
import type { ObjectRecord } from "../../_lib/types";
import { RecordHeader } from "../_components/record-header";
import { RelatedPanel } from "../_components/related-panel";
import { pickLabel } from "@/components/fields/labels";

export const metadata = { title: "Record" };

export default async function ObjectDetailPage({ params }: { params: Promise<{ key: string; id: string }> }) {
  const { key, id } = await params;
  const res = await loadObjectCtx(key);
  if (res.status === "not_found") notFound();
  if (res.status === "denied") return <EmptyState title={ot("recordsDeniedTitle", {}, res.locale)} body={ot("recordsDeniedBody", {}, res.locale)} />;
  const { ctx } = res;
  const { active } = await requireActive();
  const locale = ctx.locale;
  const noun = objectNoun(vocabFor(active.tenant), key, ctx.object);
  const nounOne = (locale === "ta" && ctx.object.label.ta?.one) || noun.one;
  const back = (
    <Link href={`/o/${key}`} className="mb-3 inline-flex items-center gap-1 text-13 text-ink-2 underline-offset-4 hover:text-ink hover:underline"><ArrowLeft className="size-3.5" aria-hidden />{ot("backToList", { nouns: (locale === "ta" && ctx.object.label.ta?.many) || noun.many }, locale)}</Link>
  );
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) notFound();
  try {
    let rec: ObjectRecord | null;
    if (ctx.demo) rec = demoRecords().find((r) => r.id === id) ?? null;
    else rec = await repo.getRecord(id, ctx.object.id, ctx.wsUuid);
    if (!rec) return <div>{back}<EmptyState title={ot("recordGoneTitle", { noun: nounOne }, locale)} body={ot("recordGoneBody", {}, locale)} /></div>;
    if (!ctx.can("read", { id: rec.id, ownerId: rec.ownerId })) return <div>{back}<EmptyState title={ot("recordsDeniedTitle", {}, locale)} body={ot("recordsDeniedBody", {}, locale)} /></div>;

    const primary = ctx.object.primaryField;
    const canWrite = ctx.can("write", { id: rec.id, ownerId: rec.ownerId }) && !ctx.support;
    const prep = prepareCustomFields({ defs: ctx.fields, values: rec.data, principal: ctx.principal, objectKey: key, canWriteRecord: canWrite });
    const titleVisible = prep.fields.some((f) => f.key === primary);
    const [layout, related] = await Promise.all([loadDetailLayout(ctx), loadRelated(ctx, rec.id).catch((e) => { console.error("[objects] related failed", e); return null; })]);

    // Layout sections drive grouping and order; fields the layout does not place are not shown for this viewer. The primary field is the title.
    const byKey = new Map(prep.fields.map((f) => [f.key, f]));
    const placed: ClientField[] = layout.spec.sections.flatMap((s) => s.fields.flatMap((k) => { const f = byKey.get(k); return f ? [{ ...f, section: s.title || ot("sectionDetails", {}, locale) }] : []; }));
    const strings = otAll(locale);

    return (
      <div className="grid gap-4" data-testid="object-record">
        <div>
          {back}
          <RecordHeader
            objectKey={key} id={rec.id} version={rec.version} title={titleVisible ? displayTitle(rec, primary) : MASK} masked={!titleVisible} strings={strings} noun={nounOne}
            primaryLabel={pickLabel(ctx.fields.find((f) => f.key === primary)?.label, locale) || ot("colTitle", {}, locale)}
            canWrite={canWrite} canDelete={ctx.can("delete", { id: rec.id, ownerId: rec.ownerId }) && !ctx.support} demo={ctx.demo} backHref={`/o/${key}`}
          />
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <CustomFieldsPanel
            key={rec.version} objectKey={key} recordId={rec.id} version={rec.version} fields={placed} values={prep.values} hiddenCount={prep.hiddenCount}
            locale={locale} demo={ctx.demo} noun={nounOne} canManage={ctx.canManageFields} revalidate={`/o/${key}/${rec.id}`} title={ot("detailsTitle", {}, locale)}
          />
          <div className="grid gap-4">
            {layout.spec.showRelated && (related
              ? <RelatedPanel objectKey={key} recordId={rec.id} items={related} canWrite={canWrite} strings={strings} noun={nounOne} />
              : <ErrorState source={ot("relatedTitle", {}, locale)} message={ot("relatedError", {}, locale)} />)}
            {layout.spec.showComments && (
              <section aria-labelledby="comments-h" className="rounded-md border border-line bg-surface p-4">
                <h2 id="comments-h" className="mb-3 text-14 font-semibold text-ink">{ot("commentsTitle", {}, locale)}</h2>
                <RecordCollab objectType={objType(key)} objectId={rec.id} />
              </section>
            )}
          </div>
        </div>
      </div>
    );
  } catch (e) {
    console.error("[objects] detail failed", e);
    return <div>{back}<ErrorState source={ot("recordsErrorSource", { nouns: noun.many }, locale)} message={ot("recordsErrorBody", {}, locale)} retry={<Link href={`/o/${key}/${id}`}><Button>{ot("retry", {}, locale)}</Button></Link>} /></div>;
  }
}
