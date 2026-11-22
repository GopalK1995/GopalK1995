// Per-connector, per-stream sync freshness from sync_runs. Pure. The threshold is 26 h for "stale"; "late" means behind the
// stream's OWN schedule (a stream that runs every 3 h and is 7 h old is late long before it is 26 h old).
import { STALE_AFTER_HOURS, type ConnectorFreshness, type FreshState } from "./types";

export interface RunLite { integrationId: string; stream: string | null; status: string; startedAt: string; mode?: string | null }
export interface IntegrationLite { id: string; label: string; connectorId: string; status: string }

const H = 3600e3;
/** A run still marked "running" after this long is not in flight any more; it is ignored rather than counted as good or failed. */
const RUNNING_STALE_H = 0.25;

export function computeFreshness(
  integrations: IntegrationLite[], runs: RunLite[], now: number,
  cadenceOf: (connectorId: string, stream: string | null) => number | null = () => null,
): ConnectorFreshness[] {
  const out: ConnectorFreshness[] = [];
  const byInt = new Map<string, RunLite[]>();
  for (const r of runs) { const l = byInt.get(r.integrationId) ?? []; l.push(r); byInt.set(r.integrationId, l); }
  for (const i of integrations) {
    const mine = (byInt.get(i.id) ?? []).slice().sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    const streams = [...new Set(mine.map((r) => r.stream ?? ""))];
    const connected = i.status === "connected" || i.status === "needs_attention" || i.status === "sandbox";
    if (!streams.length) {
      if (!connected) continue;   // a catalogue row nobody connected is not a failing sync
      streams.push("");
    }
    for (const s of streams) {
      const st = s === "" ? null : s;
      const rs = mine.filter((r) => (r.stream ?? "") === s);
      // "running" rows are in flight (or abandoned): neither a good nor a failed run.
      const settled = rs.filter((r) => r.status !== "running");
      const good = settled.find((r) => r.status === "success" || r.status === "partial");
      let consecutiveFailures = 0;
      for (const r of settled) { if (r.status === "failed") consecutiveFailures++; else break; }
      const ageHours = good ? (now - Date.parse(good.startedAt)) / H : null;
      const cadenceHours = cadenceOf(i.connectorId, st);
      const state: FreshState = ageHours === null ? "never" : ageHours > STALE_AFTER_HOURS ? "stale"
        : cadenceHours !== null && ageHours > cadenceHours * 2 ? "late" : "fresh";
      const head = rs[0];
      out.push({
        key: `${i.id}:${s}`, integrationId: i.id, label: st ? `${i.label} · ${st}` : i.label, stream: st, ageHours, lastGoodAt: good?.startedAt ?? null,
        lastStatus: (head?.status as ConnectorFreshness["lastStatus"]) ?? null, consecutiveFailures, cadenceHours, state,
        alertable: i.status === "connected" && head?.mode !== "sandbox", mode: head?.mode === "live" ? "live" : head?.mode === "sandbox" ? "sandbox" : null,
      });
    }
  }
  return out.sort((a, b) => (b.ageHours ?? Infinity) - (a.ageHours ?? Infinity));
}

/** Hours between two scheduled runs of a cron; null when the cron cannot be evaluated. */
export function cadenceFromCron(cron: string, tz: string, nextCronRun: (e: string, tz: string, after: number) => number | null, now = Date.now()): number | null {
  try {
    const a = nextCronRun(cron, tz, now);
    if (a === null) return null;
    const b = nextCronRun(cron, tz, a);
    return b === null ? null : Math.round(((b - a) / H) * 100) / 100;
  } catch { return null; }
}
