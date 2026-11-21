"use client";
// AI summary + next-best-action (spec 9): a draft for a person to review. Accept creates a task only; nothing is sent.
import { useState, useTransition } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { acceptSuggestion, dismissSuggestion } from "../../actions";
import { usePerm } from "../../_components/perm";
import { useVocab } from "@/components/shell/providers";
import { generateLeadSummary, generateNextAction } from "../../../ai/gateway-actions";

export type Suggestion = { action: string; reason: string; due: string; factors: string[] } | null;

/** real: a live workspace. Summary and next step are then generated on demand through the AI gateway (feature switch, caps, redaction, audit); the
 *  demo workspace keeps its showcase text. enabled says which of the two features the Owner has switched on. */
export function AiPanel({ leadId, summary, suggestion, basedOn, real = false, enabled }: { leadId: string; summary: string[]; suggestion: Suggestion; basedOn: string; real?: boolean; enabled?: { summary: boolean; next: boolean } }) {
  const t = useTranslations("ai");
  const [liveSummary, setLiveSummary] = useState<string[] | null>(null);
  const [liveNext, setLiveNext] = useState<Suggestion>(null);
  const [note, setNote] = useState<string | null>(null);
  const gen = (kind: "summary" | "next") => start(async () => {
    setNote(null);
    if (kind === "summary") { const r = await generateLeadSummary(leadId); if (r.ok && r.data) setLiveSummary(r.data.bullets); else setNote([r.message, r.sub].filter(Boolean).join(" ")); }
    else { const r = await generateNextAction(leadId); if (r.ok && r.data) { setLiveNext({ action: r.data.action, reason: r.data.reason, due: r.data.due, factors: r.data.factors }); setState("open"); } else setNote([r.message, r.sub].filter(Boolean).join(" ")); }
  });
  if (real) { summary = liveSummary ?? []; suggestion = liveNext; }
  const [state, setState] = useState<"open" | "accepted" | "dismissed">("open");
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const work = usePerm("workLeads");
  const reasons = useVocab().ld.dismissReasons;
  const accept = () => start(async () => {
    if (!suggestion) return;
    const r = await acceptSuggestion(leadId, suggestion.action, suggestion.due);
    toast(r.message, r.sub); if (r.ok) setState("accepted");
  });
  const dismiss = (reason: string) => start(async () => {
    const r = await dismissSuggestion(leadId, reason);
    toast(r.message, r.sub); if (r.ok) { setState("dismissed"); setAsking(false); }
  });
  return (
    <div className="space-y-4">
      {real && (
        <div className="flex flex-wrap gap-2" data-cy="ai-generate">
          {enabled?.summary && <Button size="sm" disabled={pending} onClick={() => gen("summary")} data-cy="gen-summary"><Sparkles />{t("panel.summarise")}</Button>}
          {enabled?.next && <Button size="sm" disabled={pending} onClick={() => gen("next")} data-cy="gen-next"><Sparkles />{t("panel.suggest")}</Button>}
        </div>
      )}
      {note && <p role="status" className="rounded-sm bg-warn-soft px-2 py-1.5 text-[12px] text-warn-ink" data-cy="ai-note">{note}</p>}
      {summary.length > 0 && <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h3 className="text-[12px] font-medium text-ink-2">Summary</h3><Badge tone="outline">{t("panel.aiDraft")}</Badge>
        </div>
        <ul className="list-disc space-y-1 pl-4 text-[13px] leading-5 text-ink-2 marker:text-ink-3">{summary.map((s) => <li key={s}>{s}</li>)}</ul>
      </div>}
      <div className="rounded-sm border border-line bg-paper p-3" hidden={real && !enabled?.next}>
        <h3 className="text-[12px] font-medium text-ink-2">Next best action</h3>
        <p className="mb-1.5 text-[11px] font-medium text-warn-ink">Suggested — review before acting</p>
        {!suggestion ? <p className="text-[13px] text-ink-3">{real ? t("panel.noneYet") : "No suggestion for this lead right now."}</p> : (
          <>
            <p className="text-[14px] font-medium text-ink">{suggestion.action}</p>
            <p className="mt-0.5 text-[13px] leading-5 text-ink-2">{suggestion.reason}</p>
            <p className="mt-1 text-[12px] text-ink-3 num">Suggested due: {suggestion.due}</p>
            <div className="mt-2 flex flex-wrap gap-1">{suggestion.factors.map((f) => <Badge key={f} tone="neutral">{f}</Badge>)}</div>
            {state === "open" && work === "yes" && !asking && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" disabled={pending} onClick={accept}><Check />Accept as task</Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => setAsking(true)}><X />Dismiss</Button>
              </div>
            )}
            {asking && (
              <fieldset className="mt-3">
                <legend className="mb-1.5 text-[12px] text-ink-2">Why dismiss?</legend>
                <div className="flex flex-wrap gap-1.5">
                  {reasons.map((r) => (
                    <Button key={r} size="sm" disabled={pending} onClick={() => dismiss(r)}>{r}</Button>
                  ))}
                </div>
              </fieldset>
            )}
            {state !== "open" && <p className="mt-2 text-[12px] text-ink-3">{state === "accepted" ? "Accepted: task added to your list." : "Dismissed. Logged with your reason."}</p>}
          </>
        )}
      </div>
      <p className="text-[12px] text-ink-3">Based on {basedOn}. Phone numbers and emails are never sent to the model.</p>
    </div>
  );
}
