/** Anchor (ms) of the weekly digest: noon IST on the last campaign day, else `now`, else the wall clock. Never NaN, because a NaN anchor
 * makes new Date(NaN).toISOString() throw and takes the whole Copilot page down on a workspace with no campaign data yet. */
export function digestAnchorMs(lastCampaignDay: string, nowIso: string): number {
  const fromDay = lastCampaignDay ? new Date(`${lastCampaignDay}T12:00:00+05:30`).getTime() : NaN;
  if (Number.isFinite(fromDay)) return fromDay;
  const fromNow = new Date(nowIso).getTime();
  return Number.isFinite(fromNow) ? fromNow : Date.now();
}
