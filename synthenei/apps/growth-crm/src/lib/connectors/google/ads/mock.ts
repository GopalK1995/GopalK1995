// Showcase gateway: deterministic, in memory, never touches the network. Selected for the sandbox token or APP_ENV=demo without
// credentials, refused in production. Returns the same response shape as the real API (int64 values as strings, micros).
import type { AdsGateway } from "./gateway";
import type { AdsPage, RawAdsRow } from "./report";

const DAY = 86400e3;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const CAMPAIGNS = [{ id: "9000000001", name: "Sample search campaign", base: 1200 }, { id: "9000000002", name: "Sample display campaign", base: 450 }];

export interface MockAds extends AdsGateway { readonly kind: "mock"; seed(rows: RawAdsRow[]): void }

export function makeMockAds(): MockAds {
  let seeded: RawAdsRow[] | null = null;
  return {
    kind: "mock",
    seed(rows) { seeded = rows; },
    async listCustomers() { return [{ id: "1000000001", name: "Sample ads account", currency: "INR", manager: false }]; },
    async campaignMetrics(i): Promise<AdsPage> {
      if (seeded) return { results: seeded.filter((r) => (r.segments?.date ?? "") >= i.since && (r.segments?.date ?? "") <= i.until) };
      const results: RawAdsRow[] = [];
      for (let t = Date.parse(`${i.since}T00:00:00Z`); t <= Date.parse(`${i.until}T00:00:00Z`); t += DAY) {
        const k = Math.floor(t / DAY) % 5;
        for (const c of CAMPAIGNS) {
          results.push({ campaign: { id: c.id, name: c.name }, segments: { date: ymd(t) }, metrics: { costMicros: String((c.base + k * 25) * 1_000_000 + 450_000), impressions: String(8000 + k * 100), clicks: String(90 + k), conversions: String(3.4 + k / 2) } });
        }
      }
      return { results };
    },
  };
}
