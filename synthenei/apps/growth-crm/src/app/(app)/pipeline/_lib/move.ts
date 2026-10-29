// Persisting a deal move (pure of Next.js so it is unit tested with the mocked PostgREST client).
// Stage history, events and audit rows are written by the database triggers (0002/0005/0014); this layer
// only sends the version-guarded update through the deals repository.
import { createDealsRepo } from "@/lib/db/repo/deals";
import type { Deal, DealInput } from "@/lib/db/repo/types";
import type { WonInput, LostInput } from "../actions";

const DB_PLANS = ["practice", "chambers", "enterprise"] as const;

export type MoveExtra = { won?: WonInput; lost?: LostInput };

/** Columns a Won/Lost close writes alongside the stage. Plan is stored only when it is one of the DB's plan keys. */
export function buildMovePatch(to: string, extra: MoveExtra | undefined, nowIso: string): Partial<DealInput> {
  if (to === "won" && extra?.won) {
    const w = extra.won, plan = w.plan.toLowerCase();
    return {
      wonAt: nowIso, valueInr: w.value, seats: w.seats, expectedCloseOn: w.start,
      ...((DB_PLANS as readonly string[]).includes(plan) ? { plan } : {}),
    } as Partial<DealInput>;
  }
  if (to === "lost" && extra?.lost) {
    const comp = extra.lost.competitor?.trim().slice(0, 60);
    return { lostAt: nowIso, lostReason: extra.lost.reason, ...(comp ? { competitor: comp } : {}) } as Partial<DealInput>;
  }
  return {};
}

export async function persistMove(
  repo: Pick<ReturnType<typeof createDealsRepo>, "move">,
  a: { ws: string; id: string; to: string; expectedVersion: number; extra?: MoveExtra; now?: Date },
): Promise<Deal> {
  return repo.move(a.ws, a.id, a.to, a.expectedVersion, buildMovePatch(a.to, a.extra, (a.now ?? new Date()).toISOString()));
}
