// Sandbox gateway (the "Showcase" mode): deterministic, in memory, never touches the network. Selected by config.ts for the
// documented sandbox token or APP_ENV=demo without credentials, and refused in production. Test hooks let unit and Cypress runs seed data.
import { ACCOUNT_URN_PREFIX, CAMPAIGN_URN_PREFIX } from "./constants";
import type { AdAccountAsset, LeadResponse, LeadsPage, LinkedInGateway, RawAnalytics, TokenInfo } from "./gateway";

export const LINKEDIN_MOCK_TOKEN = "linkedin-mock-token";

export interface MockGateway extends LinkedInGateway {
  readonly kind: "mock";
  seedLeads(l: LeadResponse[], questions?: Record<string, string>): void;
  seedAnalytics(rows: RawAnalytics[]): void;
}

const DAY = 86400e3;

export function makeMockGateway(now: () => Date = () => new Date()): MockGateway {
  let leads: LeadResponse[] | null = null, seeded: RawAnalytics[] | null = null, questions: Record<string, string> = { "1": "first_name", "2": "last_name", "3": "email" };
  const g: MockGateway = {
    kind: "mock",
    seedLeads(l, q) { leads = l; if (q) questions = q; },
    seedAnalytics(rows) { seeded = rows; },
    async listAdAccounts(): Promise<AdAccountAsset[]> { return [{ id: "100000001", name: "Sample ad account", currency: "INR" }]; },
    async listLeadResponses(i): Promise<LeadsPage> {
      const all = (leads ?? [{
        id: "sample-response-1", submittedAt: now().getTime() - 3600e3, ownerAccountUrn: i.accountUrn, formUrn: "urn:li:versionedLeadGenForm:(urn:li:leadGenForm:1,1)",
        campaignUrn: `${CAMPAIGN_URN_PREFIX}200000001`, testLead: false, consents: [],
        answers: [{ questionId: "1", value: "Sample" }, { questionId: "2", value: "Lead" }, { questionId: "3", value: "sample.lead@example.invalid" }],
      }]).filter((l) => l.submittedAt >= i.sinceMs).sort((a, b) => a.submittedAt - b.submittedAt);
      const rows = all.slice(i.start, i.start + i.count), next = i.start + rows.length;
      return { rows, nextStart: next < all.length ? next : undefined };
    },
    async formQuestions() { return new Map(Object.entries(questions)); },
    async analytics(i): Promise<RawAnalytics[]> {
      if (seeded) return seeded.filter((r) => { const s = r.dateRange?.start; const d = s ? `${s.year}-${String(s.month).padStart(2, "0")}-${String(s.day).padStart(2, "0")}` : ""; return d >= i.since && d <= i.until; });
      const rows: RawAnalytics[] = [];
      for (let t = Date.parse(`${i.since}T00:00:00Z`); t <= Date.parse(`${i.until}T00:00:00Z`); t += DAY) {
        const d = new Date(t), k = Math.floor(t / DAY) % 5;
        rows.push({ pivotValues: [`${CAMPAIGN_URN_PREFIX}200000001`], dateRange: { start: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() } }, costInLocalCurrency: (800 + k * 40).toFixed(2), impressions: 6000 + k * 100, clicks: 70 + k, oneClickLeads: 1 + (k % 2) });
      }
      return rows;
    },
    async campaignNames() { return new Map([["200000001", "Sample campaign"]]); },
    async accountCurrency() { return "INR"; },
    async introspect(): Promise<TokenInfo> { return { active: true, expiresAt: Math.floor(now().getTime() / 1000) + 60 * 86400, scopes: ["r_ads", "r_ads_reporting", "r_ads_leadgen_automation"] }; },
  };
  return g;
}
export const MOCK_ACCOUNT_URN = `${ACCOUNT_URN_PREFIX}100000001`;
