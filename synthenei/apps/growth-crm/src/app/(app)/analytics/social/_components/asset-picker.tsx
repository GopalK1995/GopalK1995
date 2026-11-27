"use client";
// After the Meta OAuth: choose which Facebook Pages to track (each Page's linked Instagram account is tracked with it). Several Pages can be
// ticked at once and added next to the ones already connected; a connected Page can be removed on its own. Names and ids only; page tokens
// stay on the server.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { listSocialAssets, removeSocialAccount, selectSocialAssets, type AdChoice, type PageChoice, type PageResult } from "../actions";

/** `embedded` drops the card chrome so the picker can sit inside a step of the Instagram and Facebook connect list. */
export function AssetPicker({ connectionId, embedded = false }: { connectionId: string; embedded?: boolean }) {
  const t = useTranslations("social");
  const router = useRouter();
  const [pages, setPages] = useState<PageChoice[]>([]);
  const [ads, setAds] = useState<AdChoice[]>([]);
  const [connected, setConnected] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [adId, setAdId] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [failures, setFailures] = useState<PageResult[]>([]);
  const [pending, start] = useTransition();

  // `first`: nothing is connected yet, so start with the first Page ticked, as the one-Page picker did.
  const load = (first = false) => listSocialAssets(connectionId).then((r) => {
    if (r.ok && r.data) {
      const d = r.data;
      setPages(d.pages); setAds(d.adAccounts); setConnected(d.connected);
      setPicked((cur) => (first ? (d.connected.length === 0 && d.pages[0] ? [d.pages[0].id] : []) : cur.filter((id) => !d.connected.includes(id))));
      if (d.pages.length === 0) setMsg({ ok: false, text: t("pickNoPages") });
    } else if (!r.ok) setMsg({ ok: false, text: r.message });
  });
  useEffect(() => { void load(true); }, [connectionId]);

  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const save = () => start(async () => {
    setFailures([]);
    const r = await selectSocialAssets(connectionId, picked, adId || undefined);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) { setFailures(r.data?.results.filter((x) => !x.ok) ?? []); setPicked([]); await load(); router.refresh(); }
  });
  const remove = (id: string) => start(async () => {
    setConfirming(null); setFailures([]);
    const r = await removeSocialAccount(connectionId, id);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) { await load(); router.refresh(); }
  });

  const addable = pages.filter((p) => !connected.includes(p.id));
  const mine = pages.filter((p) => connected.includes(p.id));
  const field = "h-11 rounded-control border border-field-line bg-surface px-2 text-13 text-ink md:h-8";

  const form = (
    <div className="grid max-w-md gap-4" data-testid="asset-picker">
      {mine.length > 0 && (
        <section aria-labelledby="pick-connected" className="grid gap-2">
          <h3 id="pick-connected" className="text-13 font-semibold text-ink">{t("pickConnectedHeading")}</h3>
          <ul className="grid gap-2">
            {mine.map((p) => (
              <li key={p.id} data-page={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line px-3 py-2">
                <span className="min-w-0 text-13 text-ink"><span className="font-medium">{p.name}</span>{p.igUsername ? <span className="text-ink-3"> · @{p.igUsername}</span> : null}</span>
                {confirming === p.id ? (
                  <span className="flex items-center gap-2">
                    <Button size="sm" variant="danger" className="h-11 md:h-8" onClick={() => remove(p.id)} disabled={pending} aria-busy={pending}>{t("pickRemoveConfirm")}</Button>
                    <Button size="sm" variant="quiet" className="h-11 md:h-8" onClick={() => setConfirming(null)} disabled={pending}>{t("pickRemoveCancel")}</Button>
                  </span>
                ) : (
                  <Button size="sm" variant="quiet" className="h-11 md:h-8" onClick={() => setConfirming(p.id)} disabled={pending} aria-label={t("pickRemoveAria", { name: p.name })}>{t("pickRemove")}</Button>
                )}
              </li>
            ))}
          </ul>
          {confirming && <p role="status" className="text-12 text-ink-3">{t("pickRemoveHelp")}</p>}
        </section>
      )}

      {addable.length > 0 && (
        <fieldset className="grid gap-2">
          <legend className="text-13 font-semibold text-ink">{mine.length ? t("pickAddHeading") : t("pickPage")}</legend>
          {addable.map((p) => (
            <label key={p.id} className="flex min-h-11 cursor-pointer items-start gap-2 text-13 text-ink-2 md:min-h-8">
              <input type="checkbox" className="mt-0.5 size-4" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
              <span><span className="font-medium text-ink">{p.name}</span><span className="block text-12 text-ink-3">{p.igUsername ? t("pickWithIg", { name: p.igUsername }) : t("pickNoIg")}</span></span>
            </label>
          ))}
        </fieldset>
      )}
      {pages.length > 0 && addable.length === 0 && <p className="text-13 text-ink-2">{t("pickAllConnected")}</p>}

      {addable.length > 0 && ads.length > 0 && (
        <label className="grid gap-1 text-13 text-ink-2">{t("pickAds")}
          <select value={adId} onChange={(e) => setAdId(e.target.value)} className={field}>
            <option value="">{t("pickNone")}</option>
            {ads.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      )}
      {addable.length > 0 && <div><Button variant="primary" className="h-11 md:h-8" onClick={save} disabled={pending || picked.length === 0} aria-busy={pending}>{mine.length ? t("pickAdd", { count: picked.length }) : t("pickSave")}</Button></div>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-13 text-ink-2" : "text-13 text-danger"}>{msg.text}</p>}
      {failures.length > 0 && (
        <ul role="alert" className="grid gap-1 text-13 text-danger" data-testid="pick-failures">
          {failures.map((f) => <li key={f.id}>{t("pickPageFailed", { name: f.name, reason: f.message })}</li>)}
        </ul>
      )}
    </div>
  );
  if (embedded) return form;
  return (
    <Card>
      <CardHeader title={t("pickTitle")} sub={t("pickHelp")} />
      <CardBody>{form}</CardBody>
    </Card>
  );
}
