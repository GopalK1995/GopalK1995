"use client";
// Delivery log (ledger zone): status, attempts, response code, latency, scrubbed response snippet. Replay is owner-only.
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { DisabledReason } from "@/components/ui/disabled-reason";
import { EmptyState } from "@/components/ui/states";
import { Table, td, th, tdNum } from "@/components/ui/misc";
import type { DeliveryView, EndpointView } from "@/lib/webhooks/admin";
import { replayDeliveryAction } from "../actions";

type T = (k: string, v?: Record<string, string | number>) => string;
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(v[k] ?? m));
const FILTERS = [["", "filterAll"], ["succeeded", "stSucceeded"], ["failed", "stFailed"], ["dead", "stDead"], ["pending", "stPending"]] as const;
const TONE = { succeeded: "success", failed: "warn", dead: "danger", pending: "neutral" } as const;
const ST_KEY = { succeeded: "stSucceeded", failed: "stFailed", dead: "stDead", pending: "stPending" } as const;
const COLS = ["colTime", "colEvent", "colAttempt", "colResult", "colLatency", "colNext", "colResponse", "colActions"];
const stamp = (iso: string) => iso.slice(0, 16).replace("T", " ");

export function DeliveriesView({ demo, endpoint, deliveries, isOwner, current, strings }: { demo: boolean; endpoint: EndpointView; deliveries: DeliveryView[]; isOwner: boolean; current: string; strings: Record<string, string> }) {
  const t: T = (k, v = {}) => fill(strings[k] ?? k, v);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  return (
    <div className="grid gap-4">
      {demo && <div role="note" className="rounded-control border border-line bg-paper-2 px-4 py-3 text-13 text-ink-2">{t("demoBody")}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/settings/webhooks" className="text-13 text-accent underline-offset-4 hover:underline">{t("back")}</Link>
        <nav aria-label={t("deliveries")} className="flex gap-1">
          {FILTERS.map(([v, k]) => (
            <Link key={v} href={v ? `/settings/webhooks/${endpoint.id}?status=${v}` : `/settings/webhooks/${endpoint.id}`} aria-current={current === v ? "page" : undefined}
              className={"rounded-chip border px-2 py-1 text-12 " + (current === v ? "border-line-strong bg-paper-2 text-ink" : "border-line text-ink-2 hover:bg-paper-2")}>{t(k)}</Link>
          ))}
        </nav>
      </div>
      {msg && <p role={msg.tone === "error" ? "alert" : "status"} className={msg.tone === "error" ? "text-13 text-danger" : "text-13 text-ink-2"}>{msg.text}</p>}
      {deliveries.length === 0 ? (
        <EmptyState title={t("logEmptyTitle")} body={t("logEmptyBody")} />
      ) : (
        <>
          {deliveries.length >= 100 && <p className="text-12 text-ink-3">{t("logPartial", { n: deliveries.length })}</p>}
          <Table minWidth={960}>
            <thead><tr>{COLS.map((c) => <th key={c} className={th}>{t(c)}</th>)}</tr></thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id} className="border-t border-line">
                  <td className={td + " font-mono"}>{stamp(d.createdAt)}</td>
                  <td className={td + " font-mono"}>{d.eventType}</td>
                  <td className={tdNum}>{d.attempt}</td>
                  <td className={td}>
                    <Chip tone={TONE[d.status as keyof typeof TONE] ?? "neutral"}>{t(ST_KEY[d.status as keyof typeof ST_KEY] ?? "stPending")}</Chip>
                    {d.responseStatus != null && <span className="ml-2 font-mono">{d.responseStatus}</span>}
                  </td>
                  <td className={tdNum}>{d.responseMs != null ? `${d.responseMs} ms` : ""}</td>
                  <td className={td + " font-mono"}>{d.nextAttemptAt ? stamp(d.nextAttemptAt) : ""}</td>
                  <td className="max-w-xs truncate px-3 py-2 font-mono text-12 text-ink-2" title={d.excerpt ?? ""}>{d.excerpt ?? ""}</td>
                  <td className={td}>
                    <DisabledReason reason={isOwner ? null : t("replayOwnerOnly")}>
                      <ReplayButton t={t} endpointId={endpoint.id} deliveryId={d.id} disabled={!isOwner} onDone={(r) => setMsg({ tone: r.ok ? "ok" : "error", text: [r.message, r.sub].filter(Boolean).join(". ") })} />
                    </DisabledReason>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
}

function ReplayButton({ t, endpointId, deliveryId, disabled, onDone }: { t: T; endpointId: string; deliveryId: number; disabled: boolean; onDone: (r: { ok: boolean; message: string; sub?: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="quiet" disabled={disabled}>{t("replay")}</Button></DialogTrigger>
      <DialogContent title={t("replayTitle")} description={t("replayBody")}>
        <div className="flex justify-end gap-2">
          <DialogClose asChild><Button variant="quiet">{t("cancel")}</Button></DialogClose>
          <Button variant="primary" disabled={pending} onClick={() => start(async () => { onDone(await replayDeliveryAction({ endpointId, deliveryId })); setOpen(false); })}>{t("replayConfirm")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
