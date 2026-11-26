"use client";
// One-line Meta connection health (AUD-036): permissions granted vs requested, access expiry, webhook subscription, last successful sync.
// The webhook retry is the only control. Everything shown is a date, a count or a scope name: no token ever reaches this component.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toastResult } from "@/components/ui/toast";
import { retryMetaWebhook } from "../../analytics/social/actions";
import { fmtDateTime } from "@/lib/format";
import type { MetaHealthView } from "../_lib/types";
import type { T } from "../_lib/strings";

export function MetaHealthLine({ h, t, connectionId, canRetry }: { h: MetaHealthView; t: T; connectionId: string; canRetry: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const date = h.expiresAt ? fmtDateTime(h.expiresAt).split(",")[0] ?? h.expiresAt : "";
  const parts: { text: string; bad?: boolean }[] = [
    h.scopesGranted === null ? { text: t("metaHealth.scopesUnknown") }
      : { text: `${t("metaHealth.scopes", { granted: h.scopesGranted, requested: h.scopesRequested })}${h.scopesMissing.length ? ` (${t("metaHealth.missing", { list: h.scopesMissing.join(", ") })})` : ""}`, bad: h.scopesMissing.length > 0 },
    h.expiresAt
      ? h.daysLeft !== null && h.daysLeft < 0 ? { text: t("metaHealth.expired", { date }), bad: true }
        : h.daysLeft !== null && h.daysLeft < 7 ? { text: t("metaHealth.expiresSoon", { date, days: h.daysLeft }), bad: true }
        : { text: t("metaHealth.expires", { date, days: h.daysLeft ?? "" }) }
      : { text: t(h.neverExpires ? "metaHealth.noExpiry" : "metaHealth.expiryUnknown") },
    h.webhook === "yes" ? { text: t("metaHealth.webhookYes") } : h.webhook === "no" ? { text: t("metaHealth.webhookNo"), bad: true } : { text: t("metaHealth.webhookUnknown") },
    h.lastOkAt ? { text: t("metaHealth.lastOk", { when: fmtDateTime(h.lastOkAt) }) } : { text: t("metaHealth.neverOk") },
  ];
  return (
    <div role={h.attention ? "alert" : "note"} className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border px-3 py-2 text-13 text-ink ${h.attention ? "state-warn" : "border-line bg-surface"}`} data-testid="meta-health">
      {h.attention && <strong className="font-semibold">{t("metaHealth.needsAttention")}:</strong>}
      {parts.map((p, i) => <span key={i} className={p.bad ? "font-medium" : "text-ink-2"}>{p.text}{i < parts.length - 1 ? " ·" : ""}</span>)}
      {h.webhook === "no" && canRetry && (
        <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await retryMetaWebhook(connectionId); toastResult({ ok: r.ok, message: r.message, sub: r.sub }); router.refresh(); })}>{t("metaHealth.retry")}</Button>
      )}
    </div>
  );
}
