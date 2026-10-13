// Data access layer. Screens depend ONLY on the DataSource interface, never on the mock module directly,
// so a Supabase-backed source can replace the synthetic one without touching pages.
import type {
  Account, Activity, AuditEntry, Campaign, CampaignDay, ConsentEntry, Conversation, Deal, Ga4Day, Ga4Page,
  Integration, Lead, PrivacyRequest, SyncRun, Task, TeamMember,
} from "./types";
import { datasetFor } from "./mock/generate-index";
import type { Dataset } from "./types";
import type { Workspace } from "../tenancy";
import { createSupabaseServerClient, supabaseConfigured } from "../supabase/server";

export interface DataSource {
  readonly kind: "mock" | "supabase";
  readonly workspaceId: string;
  now(): string;
  team(): Promise<TeamMember[]>;
  accounts(): Promise<Account[]>;
  account(id: string): Promise<Account | null>;
  leads(): Promise<Lead[]>;
  lead(id: string): Promise<Lead | null>;
  activities(leadId?: string): Promise<Activity[]>;
  deals(): Promise<Deal[]>;
  campaigns(): Promise<Campaign[]>;
  campaign(id: string): Promise<Campaign | null>;
  campaignDays(campaignId?: string): Promise<CampaignDay[]>;
  ga4(): Promise<{ days: Ga4Day[]; pages: Ga4Page[] }>;
  tasks(): Promise<Task[]>;
  conversations(): Promise<Conversation[]>;
  integrations(): Promise<Integration[]>;
  integration(id: string): Promise<Integration | null>;
  consent(): Promise<ConsentEntry[]>;
  privacyRequests(): Promise<PrivacyRequest[]>;
  audit(): Promise<AuditEntry[]>;
  syncRuns(): Promise<SyncRun[]>;
}

export const mockSource = (d: Dataset, workspaceId: string): DataSource => ({
  kind: "mock",
  workspaceId,
  now: () => d.now,
  team: async () => d.team,
  accounts: async () => d.accounts,
  account: async (id) => d.accounts.find((a) => a.id === id) ?? null,
  leads: async () => d.leads,
  lead: async (id) => d.leads.find((l) => l.id === id) ?? null,
  activities: async (leadId) => (leadId ? d.activities.filter((a) => a.leadId === leadId) : d.activities),
  deals: async () => d.deals,
  campaigns: async () => d.campaigns,
  campaign: async (id) => d.campaigns.find((c) => c.id === id) ?? null,
  campaignDays: async (id) => (id ? d.campaignDays.filter((x) => x.campaignId === id) : d.campaignDays),
  ga4: async () => ({ days: d.ga4, pages: d.ga4Pages }),
  tasks: async () => d.tasks,
  conversations: async () => d.conversations,
  integrations: async () => d.integrations,
  integration: async (id) => d.integrations.find((i) => i.id === id) ?? null,
  consent: async () => d.consent,
  privacyRequests: async () => d.privacyRequests,
  audit: async () => d.audit,
  syncRuns: async () => d.syncRuns,
});

/**
 * Supabase source (opt-in with DATA_SOURCE=supabase plus NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).
 * Only leads and campaigns are read from tables today; every other method falls back to the mock so the UI keeps
 * working while tables are filled. Row mapping follows supabase/schema.sql (snake_case to camelCase).
 */
function supabaseSource(ws: Workspace, fallbackSrc: DataSource): DataSource {
  // Real sessions never see synthetic rows: errors (incl. RLS denials) throw to the page error state with the
  // failing source, and an empty table renders as empty. Unmapped entities still come from fallbackSrc until wired.
  const read = async <T,>(table: string, map: (r: Record<string, unknown>) => T) => {
    const sb = await createSupabaseServerClient();
    if (!sb) throw new Error(`Supabase client unavailable (source: ${table})`);
    const { data, error } = await sb.from(table).select("*").eq("workspace_id", ws.id).limit(2000);
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    return (data ?? []).map(map);
  };
  const camel = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v]));
  return {
    ...fallbackSrc,
    kind: "supabase",
    leads: () => read("leads", (r) => camel(r) as unknown as Lead),
    campaigns: () => read("campaigns", (r) => camel(r) as unknown as Campaign),
  };
}

/** Every read is scoped to one workspace (RLS does the same server-side when Supabase is on). */
export function getDataSource(ws: Workspace, opts: { demo: boolean }): DataSource {
  const mock = mockSource(datasetFor(ws.dataset), ws.id);
  // Demo sessions ALWAYS read the mock and never touch a Supabase client.
  if (!opts.demo && process.env.DATA_SOURCE === "supabase" && supabaseConfigured()) return supabaseSource(ws, mock);
  return mock;
}
