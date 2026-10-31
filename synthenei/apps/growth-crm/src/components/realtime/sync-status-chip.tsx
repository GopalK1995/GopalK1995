"use client";
// Top-bar sync chip: live / reconnecting / offline, icon plus word (never colour alone). Demo sessions say "Sample presence".
// The shell mounts it (T059): <SyncStatusChip />. Renders nothing outside a RealtimeProvider.
import { LiveStatusChip, type LiveStatus } from "@/components/ui/chip";
import { useRealtimeContext } from "@/lib/realtime/context";
import type { ConnectionState } from "@/lib/realtime/types";
import { EN, type RealtimeStrings } from "./strings";

const STATUS: Record<ConnectionState, LiveStatus> = { live: "live", reconnecting: "stale", offline: "offline" };

export function SyncChipView({ state, demo, labels = EN }: { state: ConnectionState; demo: boolean; labels?: RealtimeStrings }) {
  const label = demo ? labels.syncSample : state === "live" ? labels.syncLive : state === "reconnecting" ? labels.syncReconnecting : labels.syncOffline;
  return (
    <span role="status" aria-live="polite" title={labels.syncTitle} data-testid="sync-chip" data-state={demo ? "sample" : state} className="inline-flex">
      <LiveStatusChip status={demo ? "sandbox" : STATUS[state]} label={label} />
    </span>
  );
}

export function SyncStatusChip({ labels }: { labels?: RealtimeStrings }) {
  const ctx = useRealtimeContext();
  if (!ctx) return null;
  return <SyncChipView state={ctx.state} demo={ctx.demo} labels={labels} />;
}
