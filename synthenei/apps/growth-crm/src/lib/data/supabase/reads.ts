// Supabase-backed reads for the entities the DataSource used to leave unwired. Everything goes through the src/lib/db
// repositories (workspace scoped, RLS applies through the user JWT); the few tables without a repo use the same typed
// query view. Errors throw (the page error state shows them); empty tables return empty arrays, never synthetic rows.
import { dbForRequest } from "@/lib/db/client";
import { toCamel } from "@/lib/db/map";
import { throwIfError } from "@/lib/db/errors";
import { from } from "@/lib/db/query";
import type { DbProvider, ListQuery } from "@/lib/db/repo/base";
import { createActivitiesRepo } from "@/lib/db/repo/activities";
import { createAuditRepo } from "@/lib/db/repo/audit";
import { createConversationsRepo } from "@/lib/db/repo/conversations";
import { createIntegrationsRepo } from "@/lib/db/repo/integrations";
import type { Page } from "@/lib/db/page";
import type {
  Activity, AiSettings, AuditEntry, ConsentEntry, Conversation, Ga4Day, Ga4Page, Holiday, Integration, PrivacyRequest, SyncRun, TeamMember,
} from "../types";
import * as m from "./mappers";
import type { Row } from "./mappers";

/** Entities still without a table (migrations 0001-0015). They stay listed in DataSource.notWired. */
export const STILL_NOT_WIRED = ["privacyRequests", "aiSettings"] as const;

export const AI_OFF: AiSettings = { scoring: true, summaries: false, nextBestAction: false, replyDrafts: false, campaignDigest: false, askCrm: false };

const PAGE = 200, MAX_PAGES = 25; // hard cap 5000 rows per entity, like the legacy reader
async function drain<T>(list: (q: ListQuery) => Promise<Page<T>>, q: Omit<ListQuery, "cursor" | "limit"> = {}): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const p = await list({ ...q, cursor, limit: PAGE });
    out.push(...p.rows);
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  return out;
}

export interface ReadOpts {
  /** Caller holds pii.read: emails and IPs are shown unmasked. Default false (masked). */
  piiRead?: boolean;
}

export function createWiredReads(ws: string, getDb: DbProvider = dbForRequest, opts: ReadOpts = {}) {
  const piiRead = opts.piiRead === true;
  const activities = createActivitiesRepo(getDb), audit = createAuditRepo(getDb), conversations = createConversationsRepo(getDb), integrations = createIntegrationsRepo(getDb);

  const table = async (name: string, shape: (q: ReturnType<typeof from>) => ReturnType<typeof from>): Promise<Row[]> => {
    const db = await getDb();
    const { data, error } = await shape(from(db, name).select().eq("workspace_id", ws).limit(5000));
    throwIfError(error);
    return ((data as Row[] | null) ?? []).map((r) => toCamel<Row>(r));
  };
  const ids = (xs: Row[], k: string) => [...new Set(xs.map((x) => x[k]).filter((v): v is string => typeof v === "string"))];

  return {
    async team(): Promise<TeamMember[]> {
      const memberships = await table("memberships", (q) => q.eq("is_active", true).order("created_at"));
      if (!memberships.length) return [];
      const db = await getDb();
      const { data, error } = await from(db, "profiles").select("id, full_name, email").in("id", ids(memberships, "userId"));
      throwIfError(error);
      const profiles = new Map(((data as Row[] | null) ?? []).map((r) => toCamel<Row>(r)).map((p) => [String(p.id), p]));
      const month = new Date().toISOString().slice(0, 7) + "-01";
      const targets = new Map((await table("sales_targets", (q) => q.eq("month", month))).map((t) => [String(t.repId), t]));
      return memberships.map((mm) => m.teamMember(mm, profiles.get(String(mm.userId)), targets.get(String(mm.userId)), piiRead));
    },

    async activities(leadId?: string): Promise<Activity[]> {
      const filters = leadId ? [{ field: "leadId", op: "eq" as const, value: leadId }] : [];
      return (await drain((q) => activities.list(ws, q), { filters })).map((r) => m.activity(r as unknown as Row));
    },

    async ga4(): Promise<{ days: Ga4Day[]; pages: Ga4Page[] }> {
      const since = new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10);
      return m.ga4Rollup(await table("ga4_daily", (q) => q.gte("day", since).order("day", { ascending: false })));
    },

    async conversations(): Promise<Conversation[]> {
      const convs = await drain((q) => conversations.list(ws, q));
      if (!convs.length) return [];
      const msgs = await table("messages", (q) => q.in("conversation_id", convs.map((c) => c.id)).order("created_at"));
      const by = new Map<string, Row[]>();
      for (const x of msgs) { const k = String(x.conversationId); by.set(k, [...(by.get(k) ?? []), x]); }
      return convs.map((c) => m.conversation(c as unknown as Row, by.get(c.id) ?? []));
    },

    async integrations(): Promise<Integration[]> {
      const rows = await drain((q) => integrations.list(ws, q));
      if (!rows.length) return [];
      const maps = await table("integration_field_maps", (q) => q);
      const runs = await table("sync_runs", (q) => q.order("started_at", { ascending: false }));
      return rows.map((r) => {
        const id = String(r.id);
        return m.integration(r as unknown as Row, maps.filter((x) => x.integrationId === id), runs.filter((x) => x.integrationId === id).slice(0, 5));
      });
    },

    async consent(): Promise<ConsentEntry[]> {
      return (await table("consent_log", (q) => q.order("occurred_at", { ascending: false }))).map(m.consentEntry).filter((x): x is ConsentEntry => x !== null);
    },

    async audit(): Promise<AuditEntry[]> {
      return (await drain((q) => audit.list(ws, q))).map((r) => m.auditEntry(r as unknown as Row, piiRead));
    },

    async syncRuns(): Promise<SyncRun[]> {
      return (await table("sync_runs", (q) => q.order("started_at", { ascending: false }))).map(m.syncRun);
    },

    /** No privacy_requests table before migration 0020: honest empty list. */
    async privacyRequests(): Promise<PrivacyRequest[]> { return []; },

    /** No ai_policies table before migration 0021: everything generative stays off. */
    async aiSettings(): Promise<AiSettings> { return AI_OFF; },

    async holidays(): Promise<Holiday[]> {
      const db = await getDb();
      const { data, error } = await from(db, "workspaces").select("holidays").eq("id", ws).maybeSingle();
      throwIfError(error);
      return m.holidays((data as Row | null)?.holidays);
    },

    /** Aggregate views (migration 0008). Rows are camelCased; metrics.ts turns them into numbers. */
    views: {
      pipelineSummary: () => table("v_pipeline_summary", (q) => q.order("position")),
      repScorecard: () => table("v_rep_scorecard", (q) => q),
      funnelDaily: () => table("v_funnel_daily", (q) => q.order("day", { ascending: false })),
    },
  };
}

export type WiredReads = ReturnType<typeof createWiredReads>;
