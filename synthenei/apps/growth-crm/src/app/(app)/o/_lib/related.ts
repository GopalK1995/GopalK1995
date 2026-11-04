// Related records of a custom-object record, read through record_links (RLS hides a link unless the caller can read BOTH ends).
// Titles of linked custom records come from the stored title, masked when the viewer cannot see that object's primary field
// (PII). Links to system records (lead, account, ...) show the type and link to the record page without reading its name, so no
// PII from another table is pulled in here.
import "server-only";
import { requireActive } from "@/lib/auth/server";
import { MASK } from "@/lib/authz/engine";
import { objectNoun } from "@/lib/metadata/labels";
import { getObjectMeta } from "@/lib/metadata/meta";
import { listObjectTypes } from "@/lib/metadata/repo";
import { visibleFields } from "@/lib/metadata/access";
import { objectUrl } from "@/lib/notify/urls";
import { vocabFor } from "@/lib/vertical";
import type { ObjectCtx } from "./ctx";
import { objType } from "./ctx";
import { DEMO_OBJECT_KEY, demoLinks, demoObject, demoRecords } from "./demo";
import { displayTitle } from "./query";
import * as repo from "./repo";
import type { LinkRow, RelatedItem } from "./types";

/** The other end of a link, seen from (type, id). Pure. */
export function otherEnd(l: LinkRow, type: string, id: string): { direction: "from" | "to"; type: string; id: string } {
  return l.fromType === type && l.fromId === id ? { direction: "to", type: l.toType, id: l.toId } : { direction: "from", type: l.fromType, id: l.fromId };
}

export function hrefFor(type: string, id: string): string | null {
  if (type.startsWith("obj:")) return `/o/${type.slice(4)}/${id}`;
  const u = objectUrl(type, id);
  return u && !u.startsWith("/records/") ? u : null;
}

export async function loadRelated(ctx: ObjectCtx, recordId: string): Promise<RelatedItem[]> {
  const { active } = await requireActive();
  const self = objType(ctx.object.key);
  const canRemove = ctx.can("write", { id: recordId });
  const vocab = vocabFor(active.tenant);
  const links = ctx.demo ? demoLinks().filter((l) => (l.fromId === recordId && l.fromType === self) || (l.toId === recordId && l.toType === self)) : await repo.listLinks(ctx.wsUuid, self, recordId);
  if (!links.length) return [];
  const ends = links.map((l) => ({ l, ...otherEnd(l, self, recordId) }));
  const customIds = ends.filter((e) => e.type.startsWith("obj:")).map((e) => e.id);

  type Meta = { label: string; titleVisible: boolean; primary: string };
  const byType = new Map<string, Meta>();
  const titles = new Map<string, string>();
  if (ctx.demo) {
    const o = demoObject();
    byType.set(`obj:${DEMO_OBJECT_KEY}`, { label: o.label.en.one, titleVisible: true, primary: o.primaryField });
    for (const r of demoRecords()) titles.set(r.id, displayTitle(r, o.primaryField));
  } else if (customIds.length) {
    const [recs, types] = await Promise.all([repo.recordsByIds(ctx.wsUuid, customIds), listObjectTypes(ctx.tenantId)]);
    for (const t of types.filter((x) => x.kind === "custom")) {
      if (!recs.some((r) => r.objectTypeId === t.id)) continue;
      const meta = await getObjectMeta(ctx.wsUuid, t.key).catch(() => null);
      const primary = t.primaryField;
      const titleVisible = !meta || visibleFields(meta.fields.filter((f) => !f.archivedAt), ctx.principal, { objectKey: t.key, canWriteRecord: false }).some((v) => v.def.key === primary);
      byType.set(`obj:${t.key}`, { label: (ctx.locale === "ta" && t.label.ta?.one) || t.label.en.one, titleVisible, primary });
      for (const r of recs.filter((x) => x.objectTypeId === t.id)) titles.set(r.id, titleVisible ? displayTitle(r, primary) : MASK);
    }
  }
  return ends.map((e): RelatedItem => {
    const meta = byType.get(e.type);
    const known = e.type.startsWith("obj:") ? titles.has(e.id) : true;
    return {
      linkId: e.l.id, direction: e.direction, type: e.type, id: e.id, relation: e.l.relation, canRemove,
      objectLabel: meta?.label ?? (e.type.startsWith("obj:") ? null : objectNoun(vocab, e.type).one),
      title: e.type.startsWith("obj:") ? (known ? titles.get(e.id)! : "") : "",
      href: known ? hrefFor(e.type, e.id) : null,
    };
  }).filter((i) => !i.type.startsWith("obj:") || i.title !== "");
}
