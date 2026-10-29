import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock, Inbox, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Decision zone: nothing here yet. Say what will appear and offer the next step. */
export function EmptyState({ title, body, action, className }: { title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div role="status" className={cn("zone-decision flex flex-col items-start gap-1 rounded-control border border-dashed border-line-strong", className)}>
      <Inbox className="mb-1 size-4 text-ink-3" strokeWidth={1.75} aria-hidden />
      <p className="text-15 font-bold tracking-[-0.015em] text-ink">{title}</p>
      {body && <p className="max-w-prose text-13 text-ink-2">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Names the failing source, says what happened, offers retry. */
export function ErrorState({ source, message, retry, className }: { source: string; message: string; retry?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn("zone-decision state-danger flex flex-col items-start gap-1 rounded-control border", className)}>
      <AlertTriangle className="mb-1 size-4" strokeWidth={1.75} aria-hidden />
      <p className="text-15 font-bold tracking-[-0.015em] text-ink">Could not load {source}</p>
      <p className="max-w-prose text-13 text-ink-2">{message}</p>
      {retry && <div className="mt-3">{retry}</div>}
    </div>
  );
}

export type PartialItem = { label: string; status: "ok" | "failed" | "pending"; detail?: string };
/** "3 of 5 sources synced" with the per-source outcome. */
export function PartialState({ done, total, items, noun = "sources synced", className }: { done: number; total: number; items: PartialItem[]; noun?: string; className?: string }) {
  return (
    <div role="status" className={cn("zone-work state-warn rounded-control border", className)}>
      <p className="text-14 font-medium text-ink">{done} of {total} {noun}</p>
      <ul className="mt-2 space-y-1 text-13 text-ink-2">
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-2" data-status={it.status}>
            {it.status === "ok" ? <CheckCircle2 className="size-3.5 text-success" aria-hidden /> : it.status === "failed" ? <XCircle className="size-3.5 text-danger" aria-hidden /> : <Clock className="size-3.5 text-ink-3" aria-hidden />}
            <span className="text-ink">{it.label}</span>
            <span className="sr-only">{it.status}</span>
            {it.detail && <span className="text-ink-3">{it.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
