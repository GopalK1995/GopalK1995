"use client";
// Related records of this record (record_links). Adding needs write on this record and read on the target; removing needs write.
// Candidates are custom-object records found by title search. Demo sessions get the demo notice and nothing is stored.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Link2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { tIn } from "@/lib/layouts/strings";
import { addLink, removeLink, searchLinkTargets } from "../actions";
import type { LinkCandidate, RelatedItem } from "../../_lib/types";

export function RelatedPanel(p: { objectKey: string; recordId: string; items: RelatedItem[]; canWrite: boolean; strings: Record<string, string>; noun: string }) {
  const router = useRouter();
  const t = tIn(p.strings);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<LinkCandidate[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const search = () => start(async () => {
    const r = await searchLinkTargets({ objectKey: p.objectKey, id: p.recordId, q });
    if (r.ok) { setFound(r.data?.items ?? []); setErr(null); } else setErr(r.message);
  });
  const add = (c: LinkCandidate) => start(async () => {
    const r = await addLink({ objectKey: p.objectKey, id: p.recordId, targetKey: c.key, targetId: c.id });
    if (r.ok) { toast(r.message, r.sub); setOpen(false); setFound(null); setQ(""); router.refresh(); } else setErr(`${r.message}${r.sub ? ` ${r.sub}` : ""}`);
  });
  const remove = (i: RelatedItem) => start(async () => {
    const r = await removeLink({ objectKey: p.objectKey, id: p.recordId, linkId: i.linkId });
    toast(r.message, r.sub);
    if (r.ok) router.refresh();
  });

  return (
    <section aria-labelledby="related-h" className="rounded-md border border-line bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h2 id="related-h" className="text-14 font-semibold text-ink">{t("relatedTitle")}</h2>
        <Button size="sm" variant="quiet" onClick={() => { setOpen(true); setFound(null); setErr(null); }} disabledReason={p.canWrite ? undefined : t("readOnlyReason")}><Plus aria-hidden />{t("linkRecord")}</Button>
      </header>
      {p.items.length === 0 ? (
        <p className="px-4 py-4 text-13 text-ink-3">{t("relatedEmpty")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {p.items.map((i) => (
            <li key={i.linkId} className="flex items-center justify-between gap-3 px-4 py-2 text-13">
              <span className="flex min-w-0 items-center gap-2">
                <Link2 className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                {i.objectLabel && <span className="text-ink-3">{i.objectLabel}</span>}
                {i.href ? <Link href={i.href} className="truncate font-medium text-ink underline-offset-4 hover:underline">{i.title || i.id.slice(0, 8)}</Link> : <span className="truncate text-ink-2">{i.title || i.id.slice(0, 8)}</span>}
                <span className="text-12 text-ink-3">{i.relation}</span>
              </span>
              {i.canRemove && <Button size="icon" variant="ghost" className="size-7" disabled={pending} aria-label={t("unlinkRecord", { title: i.title || i.id.slice(0, 8) })} onClick={() => remove(i)}><X aria-hidden /></Button>}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t("linkRecordTitle")} description={t("linkRecordBody")}>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
            <Input aria-label={t("linkSearchLabel")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("linkSearchPlaceholder")} maxLength={80} />
            <Button type="submit" variant="quiet" disabled={pending}>{t("search")}</Button>
          </form>
          {err && <p role="alert" className="mt-2 state-danger rounded-control border px-3 py-2 text-13">{err}</p>}
          {found && (found.length === 0 ? <p className="mt-3 text-13 text-ink-3">{t("linkNoResults")}</p> : (
            <ul className="mt-3 divide-y divide-line rounded-control border border-line">
              {found.map((c) => (
                <li key={`${c.key}-${c.id}`} className="flex items-center justify-between gap-2 px-3 py-2 text-13">
                  <span className="truncate">{c.label}</span>
                  <Button size="sm" variant="quiet" disabled={pending} onClick={() => add(c)}>{t("linkAdd")}</Button>
                </li>
              ))}
            </ul>
          ))}
        </DialogContent>
      </Dialog>
    </section>
  );
}
