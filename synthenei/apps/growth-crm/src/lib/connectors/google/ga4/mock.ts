// Showcase gateway: deterministic, in memory, never touches the network. Selected for the sandbox token or APP_ENV=demo without
// credentials, refused in production. Produces the same response shape as the real Data API so the normaliser is exercised end to end.
import type { Ga4Gateway } from "./gateway";
import { DIMENSIONS, METRICS } from "./constants";
import type { RunReportResponse } from "./report";

const DAY = 86400e3;
const SAMPLE = [
  { channel: "Organic Search", sm: "google / organic", device: "mobile", city: "Sample City", page: "/", campaign: "(not set)", s: 120 },
  { channel: "Paid Search", sm: "google / cpc", device: "desktop", city: "Sample City", page: "/offer", campaign: "sample-campaign-1", s: 60 },
  { channel: "Direct", sm: "(direct) / (none)", device: "mobile", city: "(not set)", page: "/", campaign: "(not set)", s: 40 },
];
const compact = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");

export function makeMockGa4(): Ga4Gateway & { kind: "mock" } {
  return {
    kind: "mock",
    async listProperties() { return [{ id: "100000001", name: "Sample website", account: "Sample account" }]; },
    async runReport(i): Promise<RunReportResponse> {
      const all: NonNullable<RunReportResponse["rows"]> = [];
      for (let t = Date.parse(`${i.since}T00:00:00Z`); t <= Date.parse(`${i.until}T00:00:00Z`); t += DAY) {
        const k = Math.floor(t / DAY) % 4;
        for (const s of SAMPLE) {
          const sessions = s.s + k * 3;
          all.push({
            dimensionValues: [compact(t), s.channel, s.sm, s.device, s.city, s.page, s.campaign].map((value) => ({ value })),
            metricValues: [sessions, Math.round(sessions * 0.7), Math.round(sessions * 0.8), Math.round(sessions * 0.5), sessions * 45, s.channel === "Paid Search" ? 4 + k : 1].map((v) => ({ value: String(v) })),
          });
        }
      }
      return {
        dimensionHeaders: DIMENSIONS.map((name) => ({ name })), metricHeaders: METRICS.map((name) => ({ name, type: "TYPE_INTEGER" })),
        rows: all.slice(i.offset, i.offset + i.limit), rowCount: all.length, metadata: { currencyCode: "INR", timeZone: "Asia/Kolkata" },
      };
    },
  };
}
