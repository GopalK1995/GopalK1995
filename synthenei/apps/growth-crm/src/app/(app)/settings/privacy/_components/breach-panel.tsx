"use client";
// Breach register: the ledger (what, who is affected, who has been told, with the 72 hour Board report clock) and the entry form.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/states";
import { Field, Input, Textarea } from "@/components/ui/form";
import type { ActionResult } from "@/lib/actions/result";
import { boardReportDueAt, boardState, type Breach } from "@/lib/privacy/breach";
import { addBreach, updateBreach } from "../actions";
import { IST_LABEL, fmtIstDateTimeZ, istInputToIso, toIstInputValue } from "@/lib/datetime";

type S = Record<string, string>;
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(k in v ? v[k] : m));
const fmt = fmtIstDateTimeZ; // every breach moment is shown in IST with the zone named
const sel = "h-8 w-full rounded-control border border-field-line bg-surface px-2 text-13 text-ink";

export function BreachPanel({ s, rows, now }: { s: S; rows: Breach[]; now: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<ActionResult<unknown>>, after?: () => void) => start(async () => { const r = await fn(); setMsg({ ok: r.ok, text: r.message }); if (r.ok) { after?.(); router.refresh(); } });
  const [f, setF] = useState({ detectedAt: "", occurredAt: "", summary: "", categories: "", affected: "", severity: "medium" as "low" | "medium" | "high", remediation: "" });
  // "Now" on the IST wall clock, filled after mount (never during render: the server and the browser would disagree by the minute).
  useEffect(() => { setF((x) => (x.detectedAt ? x : { ...x, detectedAt: toIstInputValue(new Date()) })); }, []);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ok = f.summary.trim().length >= 5 && istInputToIso(f.detectedAt) !== null;
  return (
    <div className="grid gap-5">
      <p className="text-13 text-ink-3">{s["breach.hint72"]}</p>
      {rows.length === 0 ? <EmptyState title={s["breach.empty"]} body={s["breach.emptyBody"]} /> : (
        <ul className="grid gap-3" data-testid="breach-list">
          {rows.map((b) => {
            const bs = boardState(b, now);
            return (
              <li key={b.id} className="grid gap-2 rounded-card border border-line bg-surface p-4" data-testid="breach-row" data-status={b.status} data-board={bs}>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={b.severity === "high" ? "danger" : b.severity === "medium" ? "warn" : "neutral"}>{s[`breach.sev.${b.severity}`]}</Chip>
                  <Chip tone={b.status === "closed" ? "success" : b.status === "contained" ? "info" : "warn"}>{s[`breach.st.${b.status}`]}</Chip>
                  <span className="num text-12 text-ink-3">{s["breach.detected"]}: {fmt(b.detectedAt)}</span>
                </div>
                <p className="text-14 text-ink">{b.summary}</p>
                <p className="text-13 text-ink-2">{b.categories.join(", ") || s["breach.unknown"]} · {b.affectedCount ?? s["breach.unknown"]}</p>
                <dl className="grid gap-2 text-13 sm:grid-cols-2">
                  <div>
                    <dt className="text-ink-3">{s["breach.board"]}</dt>
                    <dd className="flex flex-wrap items-center gap-2 text-ink">
                      {bs === "done" ? <Chip tone="success" icon={<CheckCircle2 aria-hidden />}>{s["breach.done"]}</Chip>
                        : <Chip tone={bs === "overdue" ? "danger" : "warn"} icon={bs === "overdue" ? <AlertTriangle aria-hidden /> : <Clock aria-hidden />}>{bs === "overdue" ? s["breach.overdue"] : s["breach.pending"]}</Chip>}
                      <span className="text-12 text-ink-3">{b.boardNotifiedAt ? fill(s["breach.notifiedOn"], { when: fmt(b.boardNotifiedAt) }) : fill(s["breach.boardDue"], { when: fmt(boardReportDueAt(b.detectedAt)) })}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">{s["breach.individuals"]}</dt>
                    <dd className="text-ink">{b.individualsNotifiedAt ? fill(s["breach.notifiedOn"], { when: fmt(b.individualsNotifiedAt) }) : s["breach.notNotified"]}</dd>
                  </div>
                </dl>
                {b.remediation && <p className="text-13 text-ink-2">{b.remediation}</p>}
                <div className="flex flex-wrap gap-2">
                  {!b.boardNotifiedAt && <Button size="sm" disabled={pending} onClick={() => run(() => updateBreach({ id: b.id, boardNotified: true }))} data-testid="mark-board">{s["breach.markBoard"]}</Button>}
                  {!b.individualsNotifiedAt && <Button size="sm" disabled={pending} onClick={() => run(() => updateBreach({ id: b.id, individualsNotified: true }))}>{s["breach.markIndividuals"]}</Button>}
                  {b.status === "open" && <Button size="sm" disabled={pending} onClick={() => run(() => updateBreach({ id: b.id, status: "contained" }))}>{s["breach.st.contained"]}</Button>}
                  {b.status !== "closed" && <Button size="sm" disabled={pending} onClick={() => run(() => updateBreach({ id: b.id, status: "closed" }))}>{s["breach.st.closed"]}</Button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section className="grid gap-3 rounded-card border border-line bg-surface p-4" aria-labelledby="add-b">
        <h2 id="add-b" className="text-15 font-semibold text-ink">{s["breach.add"]}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={`${s["breach.detected"]} (${IST_LABEL})`} required><Input type="datetime-local" value={f.detectedAt} onChange={set("detectedAt")} data-testid="breach-detected" /></Field>
          <Field label={`${s["breach.occurred"]} (${IST_LABEL})`}><Input type="datetime-local" value={f.occurredAt} onChange={set("occurredAt")} /></Field>
          <Field label={s["breach.severity"]}>{(c) => <select {...c} className={sel} value={f.severity} onChange={set("severity")}><option value="low">{s["breach.sev.low"]}</option><option value="medium">{s["breach.sev.medium"]}</option><option value="high">{s["breach.sev.high"]}</option></select>}</Field>
        </div>
        <Field label={s["breach.summary"]} required><Textarea maxLength={2000} value={f.summary} onChange={set("summary")} data-testid="breach-summary" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={s["breach.categories"]} help={s["breach.categoriesHelp"]}><Input value={f.categories} onChange={set("categories")} /></Field>
          <Field label={s["breach.affected"]}><Input type="number" min={0} value={f.affected} onChange={set("affected")} /></Field>
        </div>
        <Field label={s["breach.remediation"]}><Textarea maxLength={2000} value={f.remediation} onChange={set("remediation")} /></Field>
        <div><Button size="sm" variant="primary" disabled={pending || !ok} data-testid="breach-save" onClick={() => run(() => addBreach({
          detectedAt: istInputToIso(f.detectedAt) ?? "", occurredAt: f.occurredAt ? istInputToIso(f.occurredAt) ?? undefined : undefined, summary: f.summary,
          categories: f.categories.split(",").map((x) => x.trim()).filter(Boolean), affectedCount: f.affected === "" ? null : Number(f.affected), severity: f.severity, remediation: f.remediation || undefined,
        }), () => setF({ ...f, summary: "", categories: "", affected: "", remediation: "" }))}>{s["breach.save"]}</Button></div>
      </section>
      {msg && <p role="status" className={`text-13 ${msg.ok ? "text-ink-2" : "text-danger"}`}>{msg.text}</p>}
    </div>
  );
}
