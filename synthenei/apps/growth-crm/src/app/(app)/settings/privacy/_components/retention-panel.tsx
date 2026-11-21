"use client";
// Retention rules ledger, rule editor and dry run. The scheduled job state is shown as read from the database (On / Off / Unknown),
// never assumed. The dry run counts rows and changes nothing.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { Field, Input } from "@/components/ui/form";
import type { ActionResult } from "@/lib/actions/result";
import type { PolicyOutcome } from "@/lib/privacy/retention";
import { planRetention, removeRetentionRule, saveRetentionRule } from "../actions";
import type { RuleRow } from "../_lib/view";

type S = Record<string, string>;
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(k in v ? v[k] : m));
const OBJECTS = ["lead", "activity", "message", "lead_event", "custom"] as const;
const nameOf = (s: S, o: string) => (o.startsWith("obj:") ? `${s["retention.obj.custom"]}: ${o.slice(4)}` : s[`retention.obj.${o}`] ?? o);

export function RetentionPanel({ s, rules, job }: { s: S; rules: RuleRow[]; job: "on" | "off" | "unknown" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [out, setOut] = useState<PolicyOutcome[] | null>(null);
  const [obj, setObj] = useState<(typeof OBJECTS)[number]>("lead"), [key, setKey] = useState(""), [days, setDays] = useState("365"), [action, setAction] = useState<"anonymise" | "delete">("anonymise");
  const run = (fn: () => Promise<ActionResult<unknown>>) => start(async () => { const r = await fn(); setMsg({ ok: r.ok, text: r.message }); if (r.ok) router.refresh(); });
  const sel = "h-8 w-full rounded-control border border-line-strong bg-surface px-2 text-13 text-ink";
  const n = Number(days), objectType = obj === "custom" ? `obj:${key.trim().toLowerCase()}` : obj;
  const valid = Number.isInteger(n) && n >= 1 && n <= 3650 && (obj !== "custom" || /^[a-z][a-z0-9_-]{0,40}$/.test(key.trim().toLowerCase()));
  return (
    <div className="grid gap-5">
      <section className="rounded-card border border-line bg-surface p-4" aria-labelledby="job-h" data-testid="retention-job" data-job={job}>
        <h2 id="job-h" className="text-15 font-semibold text-ink">{s["retention.job"]}</h2>
        <p className="mt-1 text-13 text-ink-2">{job === "on" ? s["retention.jobOn"] : job === "off" ? s["retention.jobOff"] : s["retention.jobUnknown"]}</p>
      </section>

      {rules.length === 0 ? <EmptyState title={s["retention.empty"]} body={s["retention.emptyBody"]} /> : (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[560px] border-collapse text-13">
            <caption className="sr-only">{s["retention.title"]}</caption>
            <thead><tr className="border-b border-line text-left text-12 text-ink-3">
              <th scope="col" className="h-9 px-3 font-medium">{s["retention.col.object"]}</th>
              <th scope="col" className="h-9 px-3 font-medium">{s["retention.col.days"]}</th>
              <th scope="col" className="h-9 px-3 font-medium">{s["retention.col.action"]}</th>
              <th scope="col" className="h-9 px-3 font-medium">{s["retention.col.preview"]}</th>
              <th scope="col" className="h-9 px-3"><span className="sr-only">{s["retention.remove"]}</span></th>
            </tr></thead>
            <tbody>
              {rules.map((r) => {
                const o = out?.find((x) => x.objectType === r.objectType);
                return (
                  <tr key={r.objectType} className="border-b border-line last:border-0" data-testid="rule-row" data-object={r.objectType}>
                    <td className="h-10 px-3 font-medium text-ink">{nameOf(s, r.objectType)}</td>
                    <td className="num h-10 px-3 text-ink">{r.days}</td>
                    <td className="h-10 px-3 text-ink-2">{s[`retention.action.${r.action}`]}</td>
                    <td className="num h-10 px-3 text-ink-2" data-testid="rule-preview">{o ? (o.error ? o.error : `${o.matched}${o.capped ? s["retention.more"] : ""}`) : ""}</td>
                    <td className="h-10 px-3 text-right"><Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => removeRetentionRule(r.objectType))}>{s["retention.remove"]}</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section className="grid gap-2 rounded-card border border-line bg-surface p-4" aria-labelledby="dry-h">
        <h2 id="dry-h" className="text-15 font-semibold text-ink">{s["retention.dryRun"]}</h2>
        <p className="text-13 text-ink-2">{s["retention.dryRunHelp"]}</p>
        <div><Button size="sm" disabled={pending || rules.length === 0} data-testid="retention-dry-run" onClick={() => start(async () => { const r = await planRetention(); setMsg({ ok: r.ok, text: r.message }); if (r.ok && r.data) setOut(r.data); })}>{s["retention.dryRun"]}</Button></div>
        {out && <ul className="grid gap-0.5 text-13 text-ink-2" data-testid="dry-run-result">{out.map((o) => <li key={o.objectType}>{o.error ? `${nameOf(s, o.objectType)}: ${o.error}` : fill(s["retention.dryRunResult"], { object: nameOf(s, o.objectType), n: o.matched, days: rules.find((r) => r.objectType === o.objectType)?.days ?? "", more: o.capped ? s["retention.more"] : "" })}</li>)}</ul>}
      </section>

      <section className="grid gap-3 rounded-card border border-line bg-surface p-4" aria-labelledby="add-h">
        <h2 id="add-h" className="text-15 font-semibold text-ink">{s["retention.add"]}</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label={s["retention.object"]}>{(c) => <select {...c} className={sel} value={obj} onChange={(e) => setObj(e.target.value as typeof obj)} data-testid="rule-object">{OBJECTS.map((x) => <option key={x} value={x}>{s[`retention.obj.${x}`]}</option>)}</select>}</Field>
          {obj === "custom" && <Field label={s["retention.customKey"]}><Input value={key} onChange={(e) => setKey(e.target.value)} data-testid="rule-key" /></Field>}
          <Field label={s["retention.days"]} error={Number.isInteger(n) && n >= 1 ? undefined : s["retention.minDays"]}><Input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} data-testid="rule-days" /></Field>
          <Field label={s["retention.col.action"]}>{(c) => <select {...c} className={sel} value={action} onChange={(e) => setAction(e.target.value as typeof action)} data-testid="rule-action"><option value="anonymise">{s["retention.action.anonymise"]}</option><option value="delete">{s["retention.action.delete"]}</option></select>}</Field>
        </div>
        <div><Button size="sm" variant="primary" disabled={pending || !valid} data-testid="rule-save" onClick={() => run(() => saveRetentionRule({ objectType, days: n, action }))}>{s["retention.save"]}</Button></div>
      </section>
      {msg && <p role="status" className={`text-13 ${msg.ok ? "text-ink-2" : "text-danger"}`}>{msg.text}</p>}
    </div>
  );
}
