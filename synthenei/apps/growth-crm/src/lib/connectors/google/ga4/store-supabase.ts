// Supabase implementation of Ga4Store on the SERVICE-ROLE client (scheduled jobs are sanctioned users of serviceDb, CONTRACTS C6).
// RLS does not protect this path, so every query is explicitly scoped by tenant_id and workspace_id.
// Needs docs/migrations-backlog.md "T039 needs" only for the optional `campaign` column and workspace-safe key: without them rows are merged per key and the
// campaign dimension is dropped (writes retry without the column, nothing fails).
import "server-only";
import type { Db } from "@/lib/db/client";
import { mergeRows, type Ga4DailyRow } from "./report";
import type { Ga4Store } from "./store";

const failed = (what: string) => new Error(`ga4 store: ${what} failed`);   // PostgREST text can quote values: not echoed
const MISSING_COLUMN = new Set(["PGRST204", "42703"]);
const CHUNK = 500;
type Err = { code?: string } | null;
interface Del extends PromiseLike<{ error: Err }> { eq(c: string, v: unknown): Del; gte(c: string, v: unknown): Del; lte(c: string, v: unknown): Del }

export function supabaseGa4Store(db: Db): Ga4Store {
  const w = db as unknown as { from(t: string): { upsert(v: Record<string, unknown>[], o: { onConflict: string }): PromiseLike<{ error: Err }>; delete(): Del } };
  const body = (r: Ga4DailyRow, ctx: { tenantId: string; workspaceId: string; source: string }, withCampaign: boolean): Record<string, unknown> => ({
    tenant_id: ctx.tenantId, workspace_id: ctx.workspaceId, day: r.day, channel_group: r.channelGroup, source_medium: r.sourceMedium, device_category: r.deviceCategory,
    city: r.city, landing_page: r.landingPage, ...(withCampaign ? { campaign: r.campaign } : {}), sessions: r.sessions, engaged_sessions: r.engagedSessions, total_users: r.totalUsers,
    new_users: r.newUsers, avg_engagement_secs: r.avgEngagementSecs, key_events: r.keyEvents, source: ctx.source,
  });
  // New schema (T039 SQL): workspace and campaign are part of the key. Old schema: the original key, campaign merged away.
  const NEW_KEY = "tenant_id,workspace_id,day,channel_group,source_medium,device_category,city,landing_page,campaign";
  const OLD_KEY = "tenant_id,day,channel_group,source_medium,device_category,city,landing_page";
  async function write(rows: Ga4DailyRow[], ctx: { tenantId: string; workspaceId: string; source: string }, modern: boolean): Promise<Err> {
    const data = (modern ? rows : mergeRows(rows, false)).map((r) => body(r, ctx, modern));
    for (let i = 0; i < data.length; i += CHUNK) {
      const { error } = await w.from("ga4_daily").upsert(data.slice(i, i + CHUNK), { onConflict: modern ? NEW_KEY : OLD_KEY });
      if (error) return error;
    }
    return null;
  }
  return {
    async clearWindow(scope, since, until, source) {
      const { error } = await w.from("ga4_daily").delete().eq("tenant_id", scope.tenantId).eq("workspace_id", scope.workspaceId).eq("source", source).gte("day", since).lte("day", until);
      if (error) throw failed("window clear");
    },
    async upsertDaily(rows, ctx) {
      const first = await write(rows, ctx, true);
      if (!first) return;
      // No campaign column, or a key without it / without the workspace (42P10: no matching unique constraint): the original table shape.
      if (!MISSING_COLUMN.has(String(first.code ?? "")) && first.code !== "42P10") throw failed("daily upsert");
      const second = await write(rows, ctx, false);
      if (second) throw failed("daily upsert");
    },
  };
}
