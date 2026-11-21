// Showcase gateway: deterministic, in memory, never touches the network. Selected for the sandbox token or APP_ENV=demo without
// credentials, refused in production. Same response shapes as Google's APIs. Replies are recorded in memory only.
import type { GbpGateway } from "./gateway";
import { METRIC } from "./constants";
import type { RawReview, RawSeries } from "./mappers";

const DAY = 86400e3;
const day = (ms: number) => { const d = new Date(ms); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }; };

const REVIEWS: RawReview[] = [
  { reviewId: "mock-r1", starRating: "FIVE", comment: "Sample review: friendly and quick.", createTime: "2026-11-02T09:00:00Z", reviewer: { displayName: "Sample Customer A" } },
  { reviewId: "mock-r2", starRating: "TWO", comment: "Sample review: waited longer than expected.", createTime: "2026-11-05T14:30:00Z", reviewer: { displayName: "Sample Customer B" } },
  { reviewId: "mock-r3", starRating: "FOUR", createTime: "2026-11-07T18:10:00Z", reviewer: { isAnonymous: true } },
];

export interface MockGbp extends GbpGateway {
  readonly kind: "mock";
  readonly replies: { reviewId: string; comment: string }[];
  seedReviews(r: RawReview[]): void;
  seedSeries(s: RawSeries[]): void;
}

export function makeMockGbp(): MockGbp {
  let reviews = REVIEWS, series: RawSeries[] | null = null;
  const replies: { reviewId: string; comment: string }[] = [];
  return {
    kind: "mock", replies,
    seedReviews(r) { reviews = r; },
    seedSeries(s) { series = s; },
    async listLocations() { return [{ account: "1000000001", location: "2000000001", title: "Sample listing", address: "1 Sample Street, Sample City" }]; },
    async listReviews() { return { reviews: reviews.map((r) => ({ ...r, ...(replies.find((x) => x.reviewId === r.reviewId) ? { reviewReply: { comment: replies.find((x) => x.reviewId === r.reviewId)!.comment, updateTime: "2026-11-08T00:00:00Z" } } : {}) })) }; },
    async dailyMetrics(i) {
      if (series) return series;
      const dates: { date: ReturnType<typeof day>; value: string }[] = [];
      for (let t = Date.parse(`${i.since}T00:00:00Z`); t <= Date.parse(`${i.until}T00:00:00Z`); t += DAY) dates.push({ date: day(t), value: String(10 + (Math.floor(t / DAY) % 7)) });
      return Object.values(METRIC).map((m) => ({ dailyMetric: m, timeSeries: { datedValues: dates } }));
    },
    async replyToReview(i) { replies.push({ reviewId: i.reviewId, comment: i.comment }); },
  };
}
