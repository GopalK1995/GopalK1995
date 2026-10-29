// Stage-age tick device (BUILD-PLAN 3.2): one tick per day in stage, red past the stage limit.
// Pure so it is unit tested and shared by the card and the table.
export const DEFAULT_STAGE_MAX_DAYS = 14; // pipeline_stages.max_days default
export type Tick = { index: number; over: boolean };
export type TickModel = { ticks: Tick[]; days: number; max: number; over: boolean; overflow: number };

/** `cap` bounds the drawn ticks; days past it show as `overflow` (+N) so the row never grows. */
export function stageAgeTicks(days: number, max = DEFAULT_STAGE_MAX_DAYS, cap = 21): TickModel {
  const d = Math.max(0, Math.floor(Number.isFinite(days) ? days : 0));
  const m = Math.max(1, Math.floor(max));
  const n = Math.min(d, cap);
  return { ticks: Array.from({ length: n }, (_, i) => ({ index: i, over: i >= m })), days: d, max: m, over: d > m, overflow: Math.max(0, d - cap) };
}
