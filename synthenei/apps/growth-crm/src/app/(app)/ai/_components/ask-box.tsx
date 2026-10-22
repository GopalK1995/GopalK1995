"use client";
import { CircleSlash, CornerDownLeft, Database } from "lucide-react";
import { useState, useTransition } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { askCrm } from "../actions";
import type { Answer, QId } from "./ask-engine";
import { useVocab } from "@/components/shell/providers";

export function AskBox({ questions, initial }: { questions: { id: QId; q: string; metric: string }[]; initial: Answer | null }) {
  const ai = useVocab().ai;
  const [text, setText] = useState("");
  const [answers, setAnswers] = useState<Answer[]>(initial ? [initial] : []);
  const [pending, start] = useTransition();
  const reduce = useReducedMotion();
  const run = (t: string, qid: QId | null) => start(async () => { const a = await askCrm(t, qid); setAnswers((xs) => [a, ...xs].slice(0, 4)); if (!qid) setText(""); });

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) run(text, null); }} className="flex gap-2">
        <label htmlFor="ask" className="sr-only">Ask a question about your CRM numbers</label>
        <input id="ask" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder={ai.askPh}
          className="h-10 min-w-0 flex-1 rounded-sm border border-line-strong bg-surface px-3 text-[13px] outline-none placeholder:text-ink-3 focus:border-ring" />
        <Button variant="primary" size="lg" disabled={pending || !text.trim()}><CornerDownLeft />Ask</Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Approved questions">
        {questions.map((q) => (
          <button key={q.id} onClick={() => run("", q.id)} disabled={pending}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 py-1 text-left text-[12px] text-ink-2 transition-colors duration-150 hover:border-accent hover:text-ink disabled:opacity-60">
            {q.q}{q.metric && <span className="font-mono text-[10px] text-ink-3">{q.metric}</span>}
          </button>
        ))}
      </div>
      <div className={cn("mt-4 space-y-3", pending && "opacity-70")} aria-live="polite" aria-busy={pending}>
        <AnimatePresence initial={false}>
          {answers.map((a, i) => (
            <motion.article key={`${answers.length - i}-${a.question}`} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}
              className={cn("rounded-md border p-4", i === 0 ? "border-line-strong bg-surface" : "border-line bg-paper/50")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-[12px] font-medium text-ink-3">{a.question || "Question"}</p>
                {a.metric && <Badge tone="outline" className="font-mono">{a.metric}</Badge>}
              </div>
              {a.refused ? (
                <p className="mt-2 flex items-start gap-2 text-[13px] text-ink-2"><CircleSlash className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />{a.refused}</p>
              ) : (
                <>
                  <p className="mt-1.5 text-[14px] font-medium leading-5 text-ink">{a.headline}</p>
                  {a.bullets && a.bullets.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-5 text-ink-2 marker:text-ink-3">{a.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
                  {a.table && a.table.rows.length > 0 && (
                    <div className="scrollbar-thin mt-3 overflow-x-auto">
                      <table className="w-full min-w-[320px] border-collapse text-[12px]">
                        <thead><tr className="border-b border-line">{a.table.cols.map((c, j) => <th key={c} scope="col" className={cn("h-8 px-2 font-medium text-ink-3", a.table!.numeric[j] ? "text-right" : "text-left")}>{c}</th>)}</tr></thead>
                        <tbody>{a.table.rows.map((r, k) => <tr key={k} className="border-b border-line last:border-0">{r.map((v, j) => <td key={j} className={cn("h-8 px-2 text-ink", a.table!.numeric[j] && "text-right num")}>{v}</td>)}</tr>)}</tbody>
                      </table>
                    </div>
                  )}
                  <dl className="mt-3 grid gap-1 border-t border-line pt-2 text-[11px] text-ink-3 sm:grid-cols-[auto_1fr] sm:gap-x-3">
                    <dt className="font-medium">Filters</dt><dd>{a.filters?.join(" · ")}</dd>
                    <dt className="font-medium">Source</dt><dd className="flex items-center gap-1"><Database className="size-3" aria-hidden /><span className="font-mono">{a.sources?.join(", ")}</span></dd>
                    <dt className="font-medium">Access</dt><dd>{a.scopeNote}</dd>
                  </dl>
                </>
              )}
            </motion.article>
          ))}
        </AnimatePresence>
        {!answers.length && <p className="text-[12px] text-ink-3">{ai.askHelp}</p>}
      </div>
    </div>
  );
}
