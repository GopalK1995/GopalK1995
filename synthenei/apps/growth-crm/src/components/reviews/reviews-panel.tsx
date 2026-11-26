"use client";
// Reviews inbox body for Google Business Profile reviews: each review with its reply workflow. A reply is drafted (by a person, or
// suggested by the drafter), submitted, APPROVED by a named person and only then posted; the buttons mirror the server rules
// (the server re-checks every step). Actions are passed in by the page (server actions live outside this component's ownership).
import { useState, useTransition } from "react";
import { CheckCircle2, Clock, FileEdit, Send, Sparkles, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { Card, CardBody } from "@/components/ui/card";
import { StarRating } from "./star-rating";
import type { ReviewActions, ReviewView, ReplyStatusKey } from "./types";

const TONE: Record<ReplyStatusKey, ChipTone> = { none: "neutral", draft: "info", pending_approval: "warn", approved: "accent", posted: "success", failed: "danger" };
const MAX = 4096;

export function ReviewsPanel({ reviews, actions, canReply, canApprove, showcase = false, onChanged }: {
  reviews: ReviewView[]; actions: ReviewActions; canReply: boolean; canApprove: boolean; showcase?: boolean; onChanged?: () => void;
}) {
  const t = useTranslations("reviews");
  if (!reviews.length) return <p className="text-13 text-ink-3" data-testid="reviews-empty">{t("empty")}</p>;
  return (
    <div className="flex flex-col gap-3" data-testid="reviews-panel">
      {showcase && <Chip tone="info" data-testid="reviews-showcase">{t("showcase")}</Chip>}
      {reviews.map((r) => <ReviewCard key={r.id} review={r} actions={actions} canReply={canReply} canApprove={canApprove} onChanged={onChanged} />)}
    </div>
  );
}

function ReviewCard({ review: r, actions, canReply, canApprove, onChanged }: { review: ReviewView; actions: ReviewActions; canReply: boolean; canApprove: boolean; onChanged?: () => void }) {
  const t = useTranslations("reviews");
  const [text, setText] = useState(r.replyDraft ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const status = r.replyStatus;
  const editable = canReply && status !== "posted";
  const run = (fn: () => Promise<{ ok: boolean; code?: string }>) => start(async () => {
    setError(null);
    const res = await fn();
    if (!res.ok) { setError(t(`err.${res.code && ERR.has(res.code) ? res.code : "generic"}`)); return; }
    onChanged?.();
  });
  const tooLong = text.length > MAX;
  const icon = status === "posted" ? <CheckCircle2 aria-hidden /> : status === "failed" ? <XCircle aria-hidden /> : status === "pending_approval" ? <Clock aria-hidden /> : <FileEdit aria-hidden />;

  return (
    <Card data-testid="review-card" data-review-id={r.id} data-reply-status={status}>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StarRating rating={r.rating} label={r.rating === null ? t("noRating") : t("stars", { count: r.rating })} />
          <span className="text-13 font-medium">{r.author ?? t("anonymous")}</span>
          {r.reviewedAt && <span className="text-12 text-ink-3">{new Date(r.reviewedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>}
          <Chip tone={TONE[status]} icon={icon} className="ml-auto" data-testid="reply-status">{t(`status.${status}`)}</Chip>
        </div>
        <p className="whitespace-pre-wrap text-13">{r.text ?? <span className="text-ink-3">{t("noText")}</span>}</p>
        {r.externalReply && status !== "posted" && <p className="rounded-control border border-line p-2 text-12 text-ink-2" data-testid="external-reply">{t("alreadyReplied", { text: r.externalReply })}</p>}

        {(editable || r.replyDraft) && (
          <div className="flex flex-col gap-2">
            <label className="text-12 font-medium text-ink-2" htmlFor={`reply-${r.id}`}>{t("replyLabel")}</label>
            <textarea id={`reply-${r.id}`} data-testid="reply-text" className="min-h-20 w-full rounded-control border border-field-line bg-paper p-2 text-13"
              value={text} onChange={(e) => setText(e.target.value)} readOnly={!editable || status === "approved" || status === "pending_approval"} aria-invalid={tooLong} />
            {r.replySource && r.replyDraft && <p className="flex items-center gap-1 text-12 text-ink-3" data-testid="reply-source">{r.replySource !== "human" && <Sparkles className="size-3" aria-hidden />}{t(`source.${r.replySource}`)}</p>}
            {status === "approved" && <p className="text-12 text-ink-3">{t("approvedHint")}</p>}
            {status === "failed" && <p className="text-12 text-danger" role="alert">{t("failedHint")}</p>}
            {error && <p className="text-12 text-danger" role="alert" data-testid="reply-error">{error}</p>}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {editable && (status === "none" || status === "draft" || status === "failed") && (
            <>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => actions.draft(r.id))} data-testid="draft-suggest"><Sparkles aria-hidden />{t("suggest")}</Button>
              <Button size="sm" variant="secondary" disabled={pending || !text.trim() || tooLong} onClick={() => run(() => actions.draft(r.id, text))} data-testid="draft-save">{t("saveDraft")}</Button>
              <Button size="sm" variant="primary" disabled={pending || status !== "draft" || text !== (r.replyDraft ?? "")} onClick={() => run(() => actions.submit(r.id))} data-testid="submit-approval"><Send aria-hidden />{t("submit")}</Button>
            </>
          )}
          {status === "pending_approval" && (
            <>
              <Button size="sm" variant="primary" disabled={pending || !canApprove} disabledReason={canApprove ? undefined : t("needApprover")} onClick={() => run(() => actions.decide(r.id, "approve"))} data-testid="approve"><CheckCircle2 aria-hidden />{t("approve")}</Button>
              <Button size="sm" variant="secondary" disabled={pending || !canReply} onClick={() => run(() => actions.decide(r.id, "reject"))} data-testid="send-back">{t("sendBack")}</Button>
            </>
          )}
          {status === "approved" && (
            <>
              <Button size="sm" variant="primary" disabled={pending || !canApprove} disabledReason={canApprove ? undefined : t("needApprover")} onClick={() => run(() => actions.post(r.id))} data-testid="post-reply"><Send aria-hidden />{t("post")}</Button>
              <Button size="sm" variant="secondary" disabled={pending || !canReply} onClick={() => run(() => actions.draft(r.id, text))} data-testid="edit-reply">{t("edit")}</Button>
            </>
          )}
          {status === "failed" && canApprove && <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => actions.decide(r.id, "approve"))} data-testid="retry-approve">{t("retry")}</Button>}
        </div>
      </CardBody>
    </Card>
  );
}

const ERR = new Set(["not_found", "invalid_state", "invalid_input", "not_connected", "no_listing", "token_rejected", "post_failed", "audit_failed", "conflict", "not_signed_in"]);
