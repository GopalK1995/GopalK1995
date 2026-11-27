"use client";
// Owner controls for one request: move it along, note it, link a record, download the access bundle, erase, record consent.
// Every control states why it is unavailable instead of hiding. Results are announced (role=status), failures say what to do.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { fmtIstDateTimeZ } from "@/lib/datetime";
import type { ActionResult } from "@/lib/actions/result";
import type { ErasureReport } from "@/lib/privacy/erasure";
import { CONSENT_PURPOSES, type RequestKind, type RequestStatus } from "@/lib/privacy/types";
import { EraseButton, ErasureReportList } from "../../_components/privacy-controls";
import { addRequestNote, captureConsentAction, createExportDelivery, linkRequestLead, setRequestStatus } from "../actions";

type S = Record<string, string>;
function useAct() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  const run = (fn: () => Promise<ActionResult<unknown>>) => start(async () => { const r = await fn(); setMsg({ ok: r.ok, text: r.message }); if (r.ok) router.refresh(); });
  return { pending, msg, run };
}
const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) => (m ? <p role="status" className={`text-13 ${m.ok ? "text-ink-2" : "text-danger"}`}>{m.text}</p> : null);
const panel = "grid gap-2 rounded-card border border-line bg-surface p-4";

/** One-time delivery link for an access bundle. The link is shown once here; the owner sends it through a channel they trust. */
function DeliveryPanel({ s, id, leadId, demo, closed }: { s: S; id: string; leadId: string | null; demo: boolean; closed: boolean }) {
  const { pending, msg, run } = useAct();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const make = () => run(async () => { const r = await createExportDelivery(id); if (r.ok && r.data) setLink(r.data); return r; });
  const disabledReason = demo ? s["result.demo"] : !leadId ? s["detail.delivery.needLead"] : undefined;
  return (
    <section className={panel} aria-labelledby="dlv-h" data-testid="export-delivery">
      <h2 id="dlv-h" className="text-15 font-semibold text-ink">{s["detail.delivery.title"]}</h2>
      <p className="text-13 text-ink-2">{s["detail.delivery.body"]}</p>
      <div><Button size="sm" onClick={make} disabled={pending || !!disabledReason || closed} disabledReason={disabledReason}>{s["detail.delivery.create"]}</Button></div>
      <Msg m={msg} />
      {link && (
        <div className="grid gap-1" data-testid="delivery-link">
          <label htmlFor="dlv-url" className="text-13 font-medium text-ink">{s["detail.delivery.link"]}</label>
          <div className="flex gap-2">
            <Input id="dlv-url" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
            <Button size="sm" onClick={() => { void navigator.clipboard?.writeText(link.url).then(() => setCopied(true), () => undefined); }}>{copied ? s["detail.delivery.copied"] : s["detail.delivery.copy"]}</Button>
          </div>
          <p className="text-13 text-ink-3">{s["detail.delivery.expires"].replace("{when}", fmtIstDateTimeZ(link.expiresAt))}</p>
        </div>
      )}
    </section>
  );
}

export function RequestActions(p: { s: S; id: string; kind: RequestKind; status: RequestStatus; leadId: string | null; subject: string; canErase: boolean; demo: boolean }) {
  const { s } = p, closed = p.status === "completed" || p.status === "rejected";
  const [report, setReport] = useState<ErasureReport | null>(null);
  return (
    <div className="grid gap-4" data-testid="request-actions">
      {p.kind === "access" && (
        <section className={panel} aria-labelledby="acc-h">
          <h2 id="acc-h" className="text-15 font-semibold text-ink">{s["detail.access.title"]}</h2>
          <p className="text-13 text-ink-2">{s["detail.access.body"]}</p>
          <div>
            {p.leadId && !p.demo
              ? <a href={`/settings/privacy/${p.id}/export`} download data-testid="access-download" className="inline-flex h-8 items-center gap-1.5 rounded-control border border-line-strong px-3 text-13 font-medium text-ink"><Download className="size-4" aria-hidden />{s["detail.access.download"]}</a>
              : <Button size="sm" disabled disabledReason={p.demo ? s["result.demo"] : s["detail.access.needLead"]}><Download />{s["detail.access.download"]}</Button>}
          </div>
        </section>
      )}
      {p.kind === "access" && (
        <DeliveryPanel s={s} id={p.id} leadId={p.leadId} demo={p.demo} closed={closed} />
      )}
      {p.kind === "correction" && <section className={panel}><h2 className="text-15 font-semibold text-ink">{s["detail.correction.title"]}</h2><p className="text-13 text-ink-2">{s["detail.correction.body"]}</p></section>}
      {p.kind === "withdrawal" && <section className={panel}><h2 className="text-15 font-semibold text-ink">{s["detail.withdrawal.title"]}</h2><p className="text-13 text-ink-2">{s["detail.withdrawal.body"]}</p></section>}
      {p.kind === "grievance" && <section className={panel}><h2 className="text-15 font-semibold text-ink">{s["detail.grievance.title"]}</h2><p className="text-13 text-ink-2">{s["detail.grievance.body"]}</p></section>}
      {p.kind === "erasure" && (
        <section className={panel} aria-labelledby="er-h">
          <h2 id="er-h" className="text-15 font-semibold text-ink">{s["detail.erasure.title"]}</h2>
          <p className="text-13 text-ink-2">{s["detail.erasure.body"]}</p>
          <div>
            {closed ? <p className="text-13 text-ink-3">{s["detail.closed"]}</p>
              : <EraseButton requestId={p.id} subject={p.subject} s={s} onReport={setReport}
                  disabledReason={!p.leadId ? s["detail.erasure.needLead"] : !p.canErase ? s["detail.erasure.owner"] : undefined} />}
          </div>
          {report && <ErasureReportList report={report} s={s} />}
        </section>
      )}

      {closed ? <p className="text-13 text-ink-3">{s["detail.closed"]}</p> : <Workflow {...p} />}
      {!p.leadId && !closed && <LinkLead s={s} id={p.id} />}
      {p.leadId && <Consent s={s} leadId={p.leadId} />}
      <Note s={s} id={p.id} />
    </div>
  );
}

function Workflow(p: { s: S; id: string; kind: RequestKind; status: RequestStatus }) {
  const { s } = p, a = useAct();
  const [note, setNote] = useState(""), [reject, setReject] = useState("");
  return (
    <section className={panel} aria-label="Workflow">
      <div className="flex flex-wrap gap-2">
        {p.status === "received" && <Button size="sm" disabled={a.pending} onClick={() => a.run(() => setRequestStatus({ id: p.id, to: "in_progress" }))} data-testid="start-work">{s["detail.start"]}</Button>}
      </div>
      {p.kind !== "erasure" && (
        <div className="grid gap-2">
          <Field label={s["detail.completeNote"]}><Textarea maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid="complete-note" /></Field>
          <div><Button size="sm" variant="primary" disabled={a.pending || note.trim().length < 3} onClick={() => a.run(() => setRequestStatus({ id: p.id, to: "completed", note }))} data-testid="complete-request">{s["detail.complete"]}</Button></div>
        </div>
      )}
      <div className="grid gap-2">
        <Field label={s["detail.rejectReason"]}><Input maxLength={500} value={reject} onChange={(e) => setReject(e.target.value)} data-testid="reject-reason" /></Field>
        <div><Button size="sm" variant="danger" disabled={a.pending || reject.trim().length < 3} onClick={() => a.run(() => setRequestStatus({ id: p.id, to: "rejected", note: reject }))} data-testid="reject-request">{s["detail.reject"]}</Button></div>
      </div>
      <Msg m={a.msg} />
    </section>
  );
}

function LinkLead({ s, id }: { s: S; id: string }) {
  const a = useAct(), [lead, setLead] = useState("");
  return (
    <section className={panel} aria-labelledby="ll-h">
      <h2 id="ll-h" className="text-15 font-semibold text-ink">{s["detail.linkLead"]}</h2>
      <p className="text-13 text-ink-2">{s["detail.linkLeadHelp"]}</p>
      <Field label={s["detail.linkLead"]}><Input value={lead} onChange={(e) => setLead(e.target.value)} data-testid="link-lead-id" /></Field>
      <div><Button size="sm" disabled={a.pending || lead.trim().length < 8} onClick={() => a.run(() => linkRequestLead({ id, leadId: lead.trim() }))} data-testid="link-lead-save">{s["detail.linkLeadSave"]}</Button></div>
      <Msg m={a.msg} />
    </section>
  );
}

function Note({ s, id }: { s: S; id: string }) {
  const a = useAct(), [note, setNote] = useState("");
  return (
    <section className={panel} aria-labelledby="nt-h">
      <h2 id="nt-h" className="text-15 font-semibold text-ink">{s["detail.addNote"]}</h2>
      <Textarea aria-labelledby="nt-h" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid="note-text" />
      <div><Button size="sm" disabled={a.pending || !note.trim()} onClick={() => a.run(async () => { const r = await addRequestNote({ id, note }); if (r.ok) setNote(""); return r; })} data-testid="note-save">{s["detail.saveNote"]}</Button></div>
      <Msg m={a.msg} />
    </section>
  );
}

function Consent({ s, leadId }: { s: S; leadId: string }) {
  const a = useAct();
  const [purpose, setPurpose] = useState<(typeof CONSENT_PURPOSES)[number]>("marketing_email"), [action, setAction] = useState<"granted" | "withdrawn">("granted");
  const [via, setVia] = useState<"manual" | "import" | "whatsapp_optin" | "landing_form">("manual"), [note, setNote] = useState("");
  const sel = "h-8 w-full rounded-control border border-field-line bg-surface px-2 text-13 text-ink";
  return (
    <section className={panel} aria-labelledby="cs-h">
      <h2 id="cs-h" className="text-15 font-semibold text-ink">{s["consent.title"]}</h2>
      <p className="text-13 text-ink-2">{s["consent.body"]}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={s["consent.purpose"]}>{(c) => <select {...c} className={sel} value={purpose} onChange={(e) => setPurpose(e.target.value as typeof purpose)}>{CONSENT_PURPOSES.map((x) => <option key={x} value={x}>{s[`purpose.${x}`]}</option>)}</select>}</Field>
        <Field label={s["consent.action"]}>{(c) => <select {...c} className={sel} value={action} onChange={(e) => setAction(e.target.value as typeof action)}><option value="granted">{s["consent.granted"]}</option><option value="withdrawn">{s["consent.withdrawn"]}</option></select>}</Field>
        <Field label={s["consent.via"]}>{(c) => <select {...c} className={sel} value={via} onChange={(e) => setVia(e.target.value as typeof via)}>{(["manual", "import", "whatsapp_optin", "landing_form"] as const).map((x) => <option key={x} value={x}>{s[`consent.via.${x}`]}</option>)}</select>}</Field>
      </div>
      <Field label={s["consent.note"]}><Input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div><Button size="sm" disabled={a.pending} onClick={() => a.run(() => captureConsentAction({ leadId, purpose, action, via, note: note || undefined }))} data-testid="consent-save">{s["consent.save"]}</Button></div>
      <Msg m={a.msg} />
    </section>
  );
}
