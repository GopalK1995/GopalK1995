"use client";
// AI reply draft for the inbox composer (live workspaces). A draft is only ever offered to the person: "Use draft" copies it into the
// reply box, where the usual review, window and consent checks still apply. Nothing is sent from here.
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CircleAlert, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { draftReply } from "../gateway-actions";

export function ReplyDraft({ conversationId, onUse }: { conversationId: string; onUse: (text: string, lang: "en" | "ta") => void }) {
  const t = useTranslations("ai");
  const [lang, setLang] = useState<"en" | "ta">("en");
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<{ body: string; lang: "en" | "ta"; review: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const generate = () => start(async () => {
    setNote(null);
    const r = await draftReply(conversationId, lang);
    if (r.ok && r.data) setDraft({ body: r.data.body, lang, review: r.data.needsReview });
    else { setDraft(null); setNote([r.message, r.sub].filter(Boolean).join(" ")); }
  });

  return (
    <div className="m-3 mb-0 rounded-md border border-accent/30 bg-accent-soft/40 p-3" data-cy="reply-draft">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-semibold text-ink">{t("replyDraft.title")}</h3>
        <Badge tone="accent">{t("panel.aiDraft")}</Badge>
        <div role="radiogroup" aria-label={t("replyDraft.language")} className="ml-auto inline-flex rounded-sm border border-line-strong bg-surface p-0.5">
          {(["en", "ta"] as const).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={lang === l} data-cy={`draft-lang-${l}`} onClick={() => setLang(l)}
              className={cn("h-7 rounded-[3px] px-2.5 text-[12px]", lang === l ? "bg-accent text-accent-ink" : "text-ink-2 hover:text-ink")}>{l === "en" ? "English" : "தமிழ்"}</button>
          ))}
        </div>
        <Button size="sm" variant="primary" disabled={pending} onClick={generate} data-cy="draft-generate"><Sparkles />{draft ? t("replyDraft.again") : t("replyDraft.generate")}</Button>
      </div>
      {pending && <p className="mt-2 text-[12px] text-ink-3" aria-live="polite">{t("replyDraft.working")}</p>}
      {note && <p role="status" className="mt-2 flex items-start gap-1.5 rounded-sm bg-warn-soft px-2 py-1.5 text-[12px] text-warn-ink" data-cy="draft-note"><CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />{note}</p>}
      {draft && (
        <div className="mt-2" data-cy="draft-result">
          {draft.review && <Badge tone="warn">{t("replyDraft.checkTranslation")}</Badge>}
          <p lang={draft.lang} className="mt-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap text-[13px] leading-5 text-ink" data-cy="draft-body">{draft.body}</p>
          <p className="mt-1.5 text-[11px] text-ink-3">{t("replyDraft.disclosure")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => { onUse(draft.body, draft.lang); setDraft(null); }} data-cy="draft-use">{t("replyDraft.use")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}><X />{t("replyDraft.dismiss")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
