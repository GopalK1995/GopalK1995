"use client";
// Endpoint ledger: URL, events, status, failure streak, actions. Create/edit opens a dialog; a new or rotated secret is shown once.
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Copy, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Checkbox } from "@/components/ui/controls";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { DisabledReason } from "@/components/ui/disabled-reason";
import { EmptyState } from "@/components/ui/states";
import { Field, Input } from "@/components/ui/form";
import { Table, td, th } from "@/components/ui/misc";
import type { EndpointView } from "@/lib/webhooks/admin";
import { createEndpointAction, deleteEndpointAction, rotateSecretAction, testEndpointAction, updateEndpointAction } from "../actions";
import type { EventOption, IssuedSecret } from "../_lib/types";

type T = (k: string, v?: Record<string, string | number>) => string;
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(v[k] ?? m));
type Msg = { tone: "ok" | "error"; text: string };
const COLS = ["colUrl", "colEvents", "colStatus", "colFailures", "colActions"];
const host = (u: string) => { try { return new URL(u).hostname; } catch { return u; } };

export function WebhooksView({ demo, endpoints, events, policyOff, mayPii, strings }: { demo: boolean; endpoints: EndpointView[]; events: EventOption[]; policyOff: boolean; mayPii: boolean; strings: Record<string, string> }) {
  const t: T = (k, v = {}) => fill(strings[k] ?? k, v);
  const [issued, setIssued] = useState<(IssuedSecret & { rotated: boolean }) | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const report = (r: { ok: boolean; message: string; sub?: string }) => setMsg({ tone: r.ok ? "ok" : "error", text: r.ok ? [r.message, r.sub].filter(Boolean).join(". ") : r.message });
  return (
    <div className="grid gap-4">
      {demo && (
        <div role="note" className="rounded-control border border-line bg-paper-2 px-4 py-3">
          <p className="text-14 font-medium text-ink">{t("demoTitle")}</p>
          <p className="text-13 text-ink-2">{t("demoBody")}</p>
        </div>
      )}
      {policyOff && (
        <div role="note" className="rounded-control border border-line bg-paper-2 px-4 py-3">
          <p className="text-14 font-medium text-ink">{t("policyOffTitle")}</p>
          <p className="text-13 text-ink-2">{t("policyOffBody")}</p>
        </div>
      )}
      <div className="flex justify-end">
        <DisabledReason reason={policyOff ? t("policyOff") : null}>
          <EndpointDialog t={t} events={events} mayPii={mayPii} demo={demo} disabled={policyOff} onIssued={(s) => setIssued({ ...s, rotated: false })} onMessage={report} />
        </DisabledReason>
      </div>
      {msg && <p role={msg.tone === "error" ? "alert" : "status"} className={msg.tone === "error" ? "text-13 text-danger" : "text-13 text-ink-2"}>{msg.text}</p>}
      {issued && <Secret t={t} issued={issued} onDone={() => setIssued(null)} />}
      {endpoints.length === 0 ? (
        <EmptyState title={t("emptyTitle")} body={t("emptyBody")} />
      ) : (
        <Table minWidth={900}>
          <thead><tr>{COLS.map((c) => <th key={c} className={th}>{t(c)}</th>)}</tr></thead>
          <tbody>
            {endpoints.map((e) => (
              <tr key={e.id} className="border-t border-line align-top">
                <td className="px-3 py-2 text-12 text-ink">
                  <div className="font-mono">{host(e.url)}</div>
                  <div className="max-w-xs truncate text-ink-3">{e.description ?? ""}</div>
                  {demo && <Chip>{t("demoLabel")}</Chip>}
                </td>
                <td className="px-3 py-2 text-12 text-ink">
                  <div>{e.eventTypes.includes("*") ? t("allEvents") : t("eventsCount", { n: e.eventTypes.length })}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {e.includePii && <Chip tone="warn">{t("piiOn")}</Chip>}
                    {e.filters.length > 0 && <Chip>{t("filtersCount", { n: e.filters.length })}</Chip>}
                  </div>
                </td>
                <td className="px-3 py-2 text-12 text-ink">
                  <Chip tone={e.active ? "success" : e.disabledReason === "auto_failures" ? "danger" : "warn"}>{e.active ? t("statusActive") : e.disabledReason === "auto_failures" ? t("statusAutoOff") : t("statusPaused")}</Chip>
                  {e.graceUntil && <div className="mt-1 text-ink-3">{t("graceNote", { when: e.graceUntil.slice(0, 16).replace("T", " ") + " UTC" })}</div>}
                </td>
                <td className={td + " font-mono"}>{e.consecutiveFailures}</td>
                <td className="px-3 py-2">
                  <Actions t={t} e={e} events={events} mayPii={mayPii} demo={demo} policyOff={policyOff} onIssued={(s) => setIssued({ ...s, rotated: true })} onMessage={report} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function Secret({ t, issued, onDone }: { t: T; issued: IssuedSecret & { rotated: boolean }; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <section aria-labelledby="secret-h" className="rounded-control border border-line-strong bg-surface p-5">
      <h2 id="secret-h" className="text-15 font-bold text-ink">{t("secretTitle")}</h2>
      <p className="mt-1 text-13 text-ink-2">{issued.rotated && issued.graceUntil ? t("secretRotatedBody", { when: issued.graceUntil.slice(0, 16).replace("T", " ") + " UTC" }) : t("secretBody")}</p>
      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-chip border border-line bg-paper-2 px-3 py-2 font-mono text-13 text-ink" data-testid="issued-secret">{issued.secret}</code>
        <Button variant="quiet" onClick={async () => { try { await navigator.clipboard.writeText(issued.secret); setCopied(true); } catch { setCopied(false); } }}><Copy aria-hidden />{copied ? t("copied") : t("copy")}</Button>
      </div>
      <div className="mt-3"><Button variant="primary" onClick={onDone}>{t("savedIt")}</Button></div>
    </section>
  );
}

function Actions({ t, e, events, mayPii, demo, policyOff, onIssued, onMessage }: { t: T; e: EndpointView; events: EventOption[]; mayPii: boolean; demo: boolean; policyOff: boolean; onIssued: (s: IssuedSecret) => void; onMessage: (m: { ok: boolean; message: string; sub?: string }) => void }) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message: string; sub?: string }>) => start(async () => { onMessage(await fn()); });
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="quiet" disabled={pending} onClick={() => run(async () => { const r = await testEndpointAction({ id: e.id }); return { ok: r.ok, message: r.message, sub: r.ok && r.data?.simulated ? undefined : r.sub }; })}>{t("test")}</Button>
      <EndpointDialog t={t} events={events} mayPii={mayPii} demo={demo} existing={e} disabled={policyOff} onIssued={onIssued} onMessage={onMessage} />
      <Link href={`/settings/webhooks/${e.id}`} className="inline-flex h-8 items-center px-2 text-13 text-accent underline-offset-4 hover:underline">{t("deliveries")}</Link>
      <Confirm t={t} kind="pause" disabled={policyOff && !e.active} label={e.active ? t("pause") : t("resume")} name={host(e.url)} skipDialog={!e.active}
        onRun={async () => { onMessage(await updateEndpointAction({ id: e.id, active: !e.active })); }} />
      <Confirm t={t} kind="rotate" name={host(e.url)} onRun={async () => { const r = await rotateSecretAction({ id: e.id }); if (r.ok && r.data) onIssued(r.data); onMessage(r); }} />
      <Confirm t={t} kind="delete" name={host(e.url)} onRun={async () => { onMessage(await deleteEndpointAction({ id: e.id })); }} />
    </div>
  );
}

function Confirm({ t, kind, name, onRun, label, skipDialog, disabled }: { t: T; kind: "pause" | "rotate" | "delete"; name: string; onRun: () => Promise<void>; label?: string; skipDialog?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const text = label ?? t(kind);
  if (skipDialog) return <Button size="sm" variant="quiet" disabled={pending || disabled} onClick={() => start(async () => { await onRun(); })}>{text}</Button>;
  const cap = kind[0].toUpperCase() + kind.slice(1);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant={kind === "delete" ? "danger" : "quiet"}>{text}</Button></DialogTrigger>
      <DialogContent title={t(`confirm${cap}Title`, { name })} description={t(`confirm${cap}Body`)}>
        <div className="flex justify-end gap-2">
          <DialogClose asChild><Button variant="quiet">{t("cancel")}</Button></DialogClose>
          <Button variant={kind === "delete" ? "danger" : "primary"} disabled={pending} onClick={() => start(async () => { await onRun(); setOpen(false); })}>{t(`confirm${cap}`)}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EndpointDialog({ t, events, mayPii, demo, existing, disabled, onIssued, onMessage }: { t: T; events: EventOption[]; mayPii: boolean; demo: boolean; existing?: EndpointView; disabled?: boolean; onIssued: (s: IssuedSecret) => void; onMessage: (m: { ok: boolean; message: string; sub?: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(existing?.url ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [all, setAll] = useState(existing?.eventTypes.includes("*") ?? false);
  const [picked, setPicked] = useState<string[]>(existing?.eventTypes.filter((x) => x !== "*") ?? []);
  const [pii, setPii] = useState(existing?.includePii ?? false);
  const [filters, setFilters] = useState<{ field: string; values: string }[]>(existing?.filters.map((f) => ({ field: f.field, values: f.values.join(",") })) ?? []);
  const [err, setErr] = useState<string | null>(null);
  const [urlErr, setUrlErr] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const byDomain = useMemo(() => {
    const m = new Map<string, EventOption[]>();
    for (const e of events) m.set(e.domain, [...(m.get(e.domain) ?? []), e]);
    return [...m.entries()];
  }, [events]);
  const toggle = (type: string, on: boolean) => setPicked((p) => (on ? [...p, type] : p.filter((x) => x !== type)));
  const submit = () => start(async () => {
    setErr(null); setUrlErr(undefined);
    const eventTypes = all ? ["*"] : picked;
    if (eventTypes.length === 0) { setErr(t("formPickOne")); return; }
    const f = filters.filter((x) => x.field.trim()).map((x) => ({ field: x.field.trim(), values: x.values.split(",").map((v) => v.trim()).filter(Boolean) }));
    const body = { url: url.trim(), description: description.trim() || null, eventTypes, includePii: pii, filters: f };
    const r = existing ? await updateEndpointAction({ id: existing.id, ...body }) : await createEndpointAction(body);
    if (!r.ok) { setErr(r.message); setUrlErr(r.issues?.find((i) => i.path === "url")?.message); return; }
    if (!existing && r.data) onIssued(r.data);
    onMessage(r);
    setOpen(false);
    if (!existing) { setUrl(""); setDescription(""); setPicked([]); setAll(false); setPii(false); setFilters([]); }
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {existing ? <Button size="sm" variant="quiet" disabled={disabled}>{t("edit")}</Button> : <Button variant="primary" disabled={disabled}><Plus aria-hidden />{t("addEndpoint")}</Button>}
      </DialogTrigger>
      <DialogContent title={existing ? t("formEditTitle") : t("formCreateTitle")} description={demo ? t("demoBody") : undefined}>
        <div className="grid gap-3">
          <Field label={t("formUrl")} help={t("formUrlHelp")} error={urlErr} required><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" maxLength={2000} inputMode="url" /></Field>
          <Field label={t("formDescription")} help={t("formDescriptionHelp")}><Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} /></Field>
          <fieldset className="grid gap-1">
            <legend className="text-13 font-medium text-ink">{t("formEvents")}</legend>
            <p className="text-12 text-ink-3">{t("formEventsHelp")}</p>
            <label className="mt-1 flex items-center gap-2 text-13 text-ink"><Checkbox checked={all} onCheckedChange={(v) => setAll(v === true)} aria-label={t("formAllEvents")} /><span>{t("formAllEvents")}</span></label>
            {!all && (
              <div className="mt-1 grid max-h-52 gap-2 overflow-y-auto">
                {byDomain.map(([domain, list]) => (
                  <div key={domain}>
                    <p className="font-mono text-12 uppercase tracking-[0.14em] text-ink-3">{domain}</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                      {list.map((ev) => (
                        <label key={ev.type} className="flex items-center gap-2 text-13 text-ink" title={ev.description}>
                          <Checkbox checked={picked.includes(ev.type)} onCheckedChange={(v) => toggle(ev.type, v === true)} aria-label={ev.type} />
                          <span className="font-mono text-12">{ev.type}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </fieldset>
          <fieldset className="grid gap-1">
            <legend className="text-13 font-medium text-ink">{t("formFilters")}</legend>
            <p className="text-12 text-ink-3">{t("formFiltersHelp")}</p>
            {filters.map((f, i) => (
              <div key={i} className="grid grid-cols-[1fr_1.5fr_auto] items-end gap-2">
                <Field label={t("formFilterField")}><Input value={f.field} onChange={(e) => setFilters((p) => p.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))} maxLength={41} /></Field>
                <Field label={t("formFilterValues")}><Input value={f.values} onChange={(e) => setFilters((p) => p.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} /></Field>
                <Button size="sm" variant="quiet" onClick={() => setFilters((p) => p.filter((_, j) => j !== i))}>{t("formRemoveFilter")}</Button>
              </div>
            ))}
            {filters.length < 5 && <div><Button size="sm" variant="quiet" onClick={() => setFilters((p) => [...p, { field: "", values: "" }])}>{t("formAddFilter")}</Button></div>}
          </fieldset>
          <DisabledReason reason={mayPii ? null : t("formPiiDenied")}>
            <label className="flex items-start gap-2 text-13 text-ink">
              <Checkbox checked={pii} disabled={!mayPii} onCheckedChange={(v) => setPii(v === true)} aria-label={t("formPii")} />
              <span><span className="font-medium">{t("formPii")}</span><span className="block text-12 text-ink-3">{t("formPiiHelp")}</span></span>
            </label>
          </DisabledReason>
          {err && <p role="alert" className="text-13 text-danger">{err}</p>}
          <div className="flex justify-end gap-2">
            <DialogClose asChild><Button variant="quiet">{t("cancel")}</Button></DialogClose>
            <Button variant="primary" disabled={pending || url.trim().length < 8} onClick={submit}>{t("save")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
