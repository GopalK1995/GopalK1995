// Sandbox gateway (the "Showcase" mode): deterministic, in memory, never touches the network. Selected by config.ts for the
// documented sandbox token or APP_ENV=demo without credentials, and refused in production. Test hooks let unit and Cypress
// runs seed leads and read what was "sent".
import type { AdAccountAsset, GraphLead, InsightsPage, MetaGateway, PageWithToken, RawInsight, TokenDebug } from "./gateway";

export const META_MOCK_TOKEN = "meta-mock-token";

export interface MockGateway extends MetaGateway {
  readonly kind: "mock";
  sent: { recipientId: string; text: string; mid: string }[];
  seedLead(l: GraphLead): void;
  seedInsights(rows: RawInsight[]): void;
}

const DAY = 86400e3;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function makeMockGateway(now: () => Date = () => new Date()): MockGateway {
  const leads = new Map<string, GraphLead>();
  let seeded: RawInsight[] | null = null;
  let n = 0;
  const g: MockGateway = {
    kind: "mock",
    sent: [],
    seedLead(l) { leads.set(l.id, l); },
    seedInsights(rows) { seeded = rows; },
    async getLead(id) {
      return leads.get(id) ?? { id, createdAt: now().toISOString(), campaignId: "sample-campaign-1", campaignName: "Sample campaign", fields: { full_name: "Sample Lead", email: `sample-${id}@example.invalid` }, disclaimers: [] };
    },
    async listPages(): Promise<PageWithToken[]> { return [{ id: "sample-page-1", name: "Sample Page", pageToken: "sample-page-token", igUserId: "sample-ig-1", igUsername: "sample" }]; },
    async listAdAccounts(): Promise<AdAccountAsset[]> { return [{ id: "sample-act-1", name: "Sample ad account", currency: "INR" }]; },
    async subscribePage() { /* nothing to subscribe in the sandbox */ },
    async insights(i): Promise<InsightsPage> {
      if (seeded) return { rows: seeded.filter((r) => (r.date_start ?? "") >= i.since && (r.date_start ?? "") <= i.until) };
      const rows: RawInsight[] = [];
      for (let t = Date.parse(`${i.since}T00:00:00Z`); t <= Date.parse(`${i.until}T00:00:00Z`); t += DAY) {
        const d = ymd(t), k = Math.floor(t / DAY) % 5;
        rows.push({ campaign_id: "sample-campaign-1", campaign_name: "Sample campaign", date_start: d, date_stop: d, account_currency: "INR", spend: (1000 + k * 50).toFixed(2), impressions: String(10000 + k * 100), reach: String(7000 + k * 80), clicks: String(120 + k), actions: [{ action_type: "lead", value: String(2 + (k % 2)) }, { action_type: "post_reaction", value: "9" }] });
      }
      return { rows };
    },
    async igProfile() { return { name: "Sample Person", username: "sample.person" }; },
    async sendIgMessage(i) { const mid = `mock.mid.${String(++n).padStart(6, "0")}`; g.sent.push({ ...i, mid }); return { mid }; },
    async debugToken(): Promise<TokenDebug> { return { valid: true, expiresAt: 0, scopes: ["leads_retrieval", "ads_read", "instagram_manage_messages"] }; },
    async exchangeLongLived() { return { accessToken: META_MOCK_TOKEN, expiresInSec: 60 * 86400 }; },
  };
  return g;
}
