import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { MASK } from "@/lib/authz/engine";
import { requireActive } from "@/lib/auth/server";
import { fieldFilterDefs } from "@/components/fields/field-column";
import { pickLabel } from "@/components/fields/labels";
import { ot, otAll } from "@/lib/layouts/strings";
import { objectNoun } from "@/lib/metadata/labels";
import { listFieldsFor } from "@/lib/metadata/list";
import { prepareCustomFields } from "@/lib/metadata/runtime";
import { vocabFor } from "@/lib/vertical";
import { loadObjectCtx } from "../_lib/ctx";
import { demoRecords, demoViews } from "../_lib/demo";
import { loadListLayout } from "../_lib/layout-load";
import { applyFilters, displayTitle, parseListQuery, sortRecords } from "../_lib/query";
import * as repo from "../_lib/repo";
import { canEditView, effectiveQuery, resolveView } from "../_lib/views";
import { PAGE_LIMIT, type ListRow, type ObjectRecord, type SavedView } from "../_lib/types";
import { ListView } from "./_components/list-view";

type SP = Record<string, string | string[] | undefined>;

export const metadata = { title: "Records" };

export default async function ObjectListPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<SP> }) {
  const { key } = await params;
  const res = await loadObjectCtx(key);
  if (res.status === "not_found") notFound();
  if (res.status === "denied") {
    return <><PageHeader title={ot("recordsTitle", {}, res.locale)} /><EmptyState title={ot("recordsDeniedTitle", {}, res.locale)} body={ot("recordsDeniedBody", {}, res.locale)} /></>;
  }
  const { ctx } = res;
  const { active } = await requireActive();
  const locale = ctx.locale;
  const noun = objectNoun(vocabFor(active.tenant), key, ctx.object);
  const nounL = { one: (locale === "ta" && ctx.object.label.ta?.one) || noun.one, many: (locale === "ta" && ctx.object.label.ta?.many) || noun.many };
  const header = <PageHeader title={nounL.many.charAt(0).toUpperCase() + nounL.many.slice(1)} sub={ot("recordsSub", { nouns: nounL.many }, locale)} />;
  try {
    const sp = await searchParams;
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string") usp.set(k, v); else if (Array.isArray(v) && v[0] !== undefined) usp.set(k, v[0]);

    const primary = ctx.object.primaryField;
    const [layout, views] = await Promise.all([
      loadListLayout(ctx),
      ctx.demo ? Promise.resolve(demoViews()) : repo.listViews(ctx.wsUuid, ctx.object.id).catch(() => [] as SavedView[]),
    ]);
    const q = parseListQuery(ctx.fields, usp);
    const view = views.find((v) => v.id === q.viewId) ?? null;
    const eff = effectiveQuery(ctx.fields, q, view);

    // Fetch (RLS applies for real sessions), then evaluate the exact filters, sort and mask.
    let records: ObjectRecord[]; let truncated = false;
    if (ctx.demo) records = applyFilters(demoRecords(), ctx.fields, eff.filters, q.q, primary);
    else {
      const r = await repo.listRecords({ objectTypeId: ctx.object.id, workspaceId: ctx.wsUuid, q: q.q, filters: eff.filters, defs: ctx.fields, primaryKey: primary });
      records = r.rows; truncated = r.truncated;
    }
    records = sortRecords(records, eff.sort, primary);
    const narrowed = !!q.q || !!view || Object.keys(eff.filters).length > 0;

    const cf = listFieldsFor(ctx.fields, ctx.principal, key);
    const visible = new Set(cf.fields.map((f) => f.key));
    const titleVisible = visible.has(primary);
    const rows: ListRow[] = records.map((r) => {
      const masked = cf.maskRow({ custom: r.data }).custom ?? {};
      return { id: r.id, title: titleVisible ? displayTitle(r, primary) : MASK, custom: masked, updatedAt: r.updatedAt, version: r.version };
    });

    const wanted = eff.columns.length ? eff.columns : layout.spec.columns;
    const columnIds = wanted.filter((c) => c === "title" || visible.has(c.slice(7)));
    const fields = cf.fields.filter((f) => f.key !== primary);
    const prep = prepareCustomFields({ defs: ctx.fields, values: {}, principal: ctx.principal, objectKey: key, canWriteRecord: ctx.access.write });
    const primaryDef = prep.fields.find((f) => f.key === primary);
    const formFields = [...(primaryDef?.edit ? [primaryDef] : []), ...prep.fields.filter((f) => f.edit && f.key !== primary)];

    return (
      <>
        {header}
        <ListView
          objectKey={key} locale={locale} strings={otAll(locale)} demo={ctx.demo} noun={nounL}
          primaryLabel={pickLabel(ctx.fields.find((f) => f.key === primary)?.label, locale) || ot("colTitle", {}, locale)}
          rows={rows} truncated={truncated || rows.length >= PAGE_LIMIT} fields={fields} columnIds={columnIds} formFields={formFields} filterDefs={fieldFilterDefs(fields, locale)}
          views={views.map((v) => ({ ...resolveView(ctx.fields, v), canEdit: canEditView(v, ctx.uid, ctx.canShareViews) }))} activeViewId={view?.id ?? null}
          current={{ filters: eff.filters, sort: eff.sort, columns: columnIds }}
          canWrite={ctx.access.write && !ctx.support} canShare={ctx.canShareViews} hasAnyRecords={rows.length > 0 || narrowed}
        />
      </>
    );
  } catch (e) {
    console.error("[objects] list failed", e);
    return <>{header}<ErrorState source={ot("recordsErrorSource", { nouns: nounL.many }, locale)} message={ot("recordsErrorBody", {}, locale)} retry={<Link href={`/o/${key}`}><Button>{ot("retry", {}, locale)}</Button></Link>} /></>;
  }
}
