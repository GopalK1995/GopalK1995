// Attribution from the touches the CRM actually recorded (leads.first_touch_channel / last_touch_channel, written by the capture RPC).
// The shared lead mapper defaults a missing touch to "organic", which would credit Organic with every lead nobody tagged; here a
// missing touch stays its own row ("No touch recorded"). Demo sessions pass no override and use the sample leads as they are.
import type { Lead } from "@/lib/data/types";
import { CHANNEL_LABEL } from "@/lib/data/metrics";

export type TouchRow = { ch: string; label: string; leads: number; demos: number; won: number };
export type Touches = Map<string, { first: string | null; last: string | null }>;
export const UNKNOWN_TOUCH = "unknown";

export function attributionFromTouches(leads: Lead[], model: "first" | "last", opts: { touches?: Touches; unknownLabel: string; isDemo: (l: Lead) => boolean; isWon: (l: Lead) => boolean }): TouchRow[] {
  const m = new Map<string, TouchRow>();
  for (const l of leads) {
    const t = opts.touches?.get(l.id);
    const raw = opts.touches ? (t ? (model === "first" ? t.first : t.last) : null) : model === "first" ? l.firstTouch : l.lastTouch;
    const ch = raw && raw in CHANNEL_LABEL ? raw : UNKNOWN_TOUCH;
    const r = m.get(ch) ?? { ch, label: ch === UNKNOWN_TOUCH ? opts.unknownLabel : CHANNEL_LABEL[ch as keyof typeof CHANNEL_LABEL], leads: 0, demos: 0, won: 0 };
    r.leads++; if (opts.isDemo(l)) r.demos++; if (opts.isWon(l)) r.won++;
    m.set(ch, r);
  }
  // The "no touch" row always sorts last so it never reads as the top channel.
  return [...m.values()].sort((a, b) => (a.ch === UNKNOWN_TOUCH ? 1 : b.ch === UNKNOWN_TOUCH ? -1 : b.leads - a.leads));
}
