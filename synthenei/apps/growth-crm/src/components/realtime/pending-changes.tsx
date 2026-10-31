"use client";
// Non-intrusive fallback while the user is mid-edit: changes are held, not applied. Polite live region, no animation.
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EN, fill, type RealtimeStrings } from "./strings";

export function PendingChanges({ count, onRefresh, labels = EN }: { count: number; onRefresh: () => void; labels?: RealtimeStrings }) {
  if (count <= 0) return null;
  const text = count === 1 ? labels.pendingOne : fill(labels.pending, { n: count });
  return (
    <div role="status" aria-live="polite" data-testid="pending-changes" className="inline-flex items-center gap-2 rounded-chip border border-line bg-paper-2 px-2 py-1 text-12 text-ink-2">
      <RefreshCw className="size-3" aria-hidden />
      <span>{text}</span>
      <Button size="sm" variant="ghost" onClick={onRefresh}>{labels.refresh}</Button>
    </div>
  );
}
