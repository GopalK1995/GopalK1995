// Data access layer. Screens depend ONLY on the DataSource interface, never on the mock module directly,
// so a Supabase-backed source can replace the synthetic one without touching pages.
import type {
  Account, Activity, AuditEntry, Campaign, CampaignDay, ConsentEntry, Conversation, Deal, Ga4Day, Ga4Page,
  Integration, Lead, PrivacyRequest, SyncRun, Task, TeamMember,
} from "./types";
import { datasetFor } from "./mock/generate-index";
import type { AiSettings, Dataset, Holiday } from "./types";

import { AI_OFF, STILL_NOT_WIRED, createWiredReads, type WiredReads } from "./supabase/reads";
const TN_HOLIDAYS: Holiday[] = [
  { date: "2026-10-20", name: "Ayudha Pooja" }, { date: "2026-10-21", name: "Vijayadasami" }, { date: "2026-11-08", name: "Deepavali" },
  { date: "2026-12-25", name: "Christmas" }, { date: "2027-01-14", name: "Pongal" }, { date: "2027-01-15", name: "Thiruvalluvar Day" }, { date: "2027-01-16", name: "Uzhavar Thirunal" },
];
import type { Workspace } from "../tenancy";
import { createSupabaseServerClient } from "../supabase/server";
import { loadEnv } from "../env";

export interface DataSource {
  readonly kind: "mock" | "supabase";
  readonly workspaceId: string;
  /** Entities this source cannot read yet (real sessions show "Not connected yet" instead of data). */
  readonly notWired?: string[];
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
  /** Per-workspace AI feature switches (spec 9: all off by default; demo shows them as showcase). */
  aiSettings(): Promise<AiSettings>;
  /** Tenant holiday list entered by the Owner (not fetched). */
  holidays(): Promise<Holiday[]>;
  /** Raw aggregate view rows (supabase only; see the view mappers in metrics.ts). Mock sources compute from arrays instead. */
  readonly views?: WiredReads["views"];
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
  // Demo tenant: rule-based scoring on; generative features shown as showcase (still "off" for real use).
  aiSettings: async () => AI_OFF,
  holidays: async () => TN_HOLIDAYS,
});

/**
 * Supabase source (opt-in with DATA_SOURCE=supabase plus NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).
 * Leads, accounts, deals, tasks and campaigns read their tables directly; every other entity comes from ./supabase/reads.
 * Row mapping follows supabase/schema.sql (snake_case to camelCase).
 */
function supabaseSource(ws: Workspace, piiRead: boolean): DataSource {
  // Real sessions NEVER see synthetic rows. Errors (incl. RLS denials) throw to the page error state with the failing
  // source; empty tables render empty; entities not mapped yet return []/null and are listed in `notWired`.
  const read = async <T,>(table: string, map: (r: Record<string, unknown>) => T) => {
    const sb = await createSupabaseServerClient();
    if (!sb) throw new Error(`Supabase client unavailable (source: ${table})`);
    const { data, error } = await sb.from(table).select("*").eq("workspace_id", ws.uuid).limit(5000);
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    return (data ?? []).map(map);
  };
  const camel = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v])) as never;
  const byId = <T extends { id: string },>(get: () => Promise<T[]>) => async (id: string) => (await get()).find((x) => x.id === id) ?? null;
  const leads = () => read<Lead>("leads", camel), accounts = () => read<Account>("accounts", camel), deals = () => read<Deal>("deals", camel);
  const tasks = () => read<Task>("tasks", camel), campaigns = () => read<Campaign>("campaigns", camel);
  const campaignDays = async (id?: string) => { const xs = await read<CampaignDay>("campaign_daily_metrics", camel); return id ? xs.filter((x) => x.campaignId === id) : xs; };
  const w = createWiredReads(ws.uuid, undefined, { piiRead });
  return {
    kind: "supabase", workspaceId: ws.id,
    // Only entities without a table in migrations 0001-0015 remain: privacy requests (0020) and AI policies (0021).
    notWired: [...STILL_NOT_WIRED],
    now: () => new Date().toISOString(),
    team: w.team, leads, lead: byId(leads), accounts, account: byId(accounts), deals, tasks, campaigns, campaign: byId(campaigns), campaignDays,
    activities: w.activities, ga4: w.ga4, conversations: w.conversations, integrations: w.integrations,
    integration: async (id) => (await w.integrations()).find((x) => x.id === id) ?? null,
    consent: w.consent, privacyRequests: w.privacyRequests, audit: w.audit, syncRuns: w.syncRuns,
    aiSettings: w.aiSettings, holidays: w.holidays, views: w.views,
  };
}

/** Every read is scoped to one workspace (RLS does the same server-side when Supabase is on). */
export function getDataSource(ws: Workspace, opts: { demo: boolean; /** caller holds pii.read; default false = masked */ piiRead?: boolean }): DataSource {
  const mock = mockSource(datasetFor(ws.dataset), ws.id);
  // Demo sessions ALWAYS read the mock and never touch a Supabase client.
  if (!opts.demo && loadEnv().dataSourceSupabase) return supabaseSource(ws, opts.piiRead === true);
  return mock;
}
