"use client";
// After the Meta OAuth: choose the Facebook Page (its linked Instagram account is tracked with it). Names and ids only; page tokens stay on the server.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { listSocialAssets, selectSocialAssets, type AdChoice, type PageChoice } from "../actions";

export function AssetPicker({ connectionId }: { connectionId: string }) {
  const t = useTranslations("social");
  const router = useRouter();
  const [pages, setPages] = useState<PageChoice[]>([]);
  const [ads, setAds] = useState<AdChoice[]>([]);
  const [pageId, setPageId] = useState("");
  const [adId, setAdId] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    void listSocialAssets(connectionId).then((r) => {
      if (!live) return;
      if (r.ok && r.data) {
        setPages(r.data.pages); setAds(r.data.adAccounts); setPageId(r.data.pages[0]?.id ?? "");
        if (r.data.pages.length === 0) setMsg({ ok: false, text: t("pickNoPages") });
      }
      else if (!r.ok) setMsg({ ok: false, text: r.message });
    });
    return () => { live = false; };
  }, [connectionId]);

  const save = () => start(async () => {
    const r = await selectSocialAssets(connectionId, pageId, adId || undefined);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) router.refresh();
  });
  const chosen = pages.find((p) => p.id === pageId);

  return (
    <Card>
      <CardHeader title={t("pickTitle")} sub={t("pickHelp")} />
      <CardBody>
        <div className="grid max-w-md gap-3">
          <label className="grid gap-1 text-13 text-ink-2">{t("pickPage")}
            <select value={pageId} onChange={(e) => setPageId(e.target.value)} className="h-8 rounded-control border border-field-line bg-surface px-2 text-13 text-ink">
              {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {chosen && <p className="text-12 text-ink-3">{chosen.igUsername ? t("pickWithIg", { name: chosen.igUsername }) : t("pickNoIg")}</p>}
          {ads.length > 0 && (
            <label className="grid gap-1 text-13 text-ink-2">{t("pickAds")}
              <select value={adId} onChange={(e) => setAdId(e.target.value)} className="h-8 rounded-control border border-field-line bg-surface px-2 text-13 text-ink">
                <option value="">{t("pickNone")}</option>
                {ads.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          )}
          <div><Button variant="primary" onClick={save} disabled={pending || !pageId} aria-busy={pending}>{t("pickSave")}</Button></div>
          {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-13 text-ink-2" : "text-13 text-danger"}>{msg.text}</p>}
        </div>
      </CardBody>
    </Card>
  );
}
