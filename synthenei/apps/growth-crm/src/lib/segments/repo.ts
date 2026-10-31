// Repositories for the two tables this task owns the UI of but not a shared repo file for: audience_segments (versioned) and
// campaign_daily_metrics (composite key, upsert). Campaigns use the shared campaignsRepo from src/lib/db/repo.
import { dbForRequest } from "@/lib/db/client";
import { throwIfError } from "@/lib/db/errors";
import { toCamel, toSnake } from "@/lib/db/map";
import { from } from "@/lib/db/query";
import { makeRepo, type DbProvider } from "@/lib/db/repo/base";
import type { MetricRow } from "./metrics-csv";
import type { SegmentRule } from "./compile";

export interface SegmentRow { id: string; workspaceId: string; name: string; isIcp: boolean; rules: unknown; createdBy: string | null; createdAt: string; updatedAt: string; version: number }
export interface SegmentInput { name: string; isIcp?: boolean; rules: SegmentRule[]; createdBy?: string | null }

export function createSegmentsRepo(getDb: DbProvider = dbForRequest) {
  const r = makeRepo<SegmentRow, SegmentInput>({ table: "audience_segments" }, getDb);
  return { list: r.list, get: r.get, create: r.create, update: r.updateV };
}
export const segmentsRepo = createSegmentsRepo();

export interface DayRow extends MetricRow { source: string }
type Upserter = { upsert(v: Record<string, unknown>[], o: { onConflict: string }): PromiseLike<{ error: { code?: string; message?: string } | null }> };

export function createMetricsRepo(getDb: DbProvider = dbForRequest) {
  return {
    async listForCampaign(ws: string, campaignId: string, limit = 400): Promise<DayRow[]> {
      const db = await getDb();
      const { data, error } = await from(db, "campaign_daily_metrics").select().eq("workspace_id", ws).eq("campaign_id", campaignId).order("day", { ascending: false }).limit(limit);
      throwIfError(error);
      return ((data as Record<string, unknown>[] | null) ?? []).map((r) => toCamel<DayRow>(r));
    },
    async listAll(ws: string, limit = 5000): Promise<DayRow[]> {
      const db = await getDb();
      const { data, error } = await from(db, "campaign_daily_metrics").select().eq("workspace_id", ws).order("day", { ascending: false }).limit(limit);
      throwIfError(error);
      return ((data as Record<string, unknown>[] | null) ?? []).map((r) => toCamel<DayRow>(r));
    },
    /** Idempotent per (campaign, day): re-importing a file overwrites the same days instead of doubling spend. */
    async upsertDays(ws: string, rows: MetricRow[], source: "manual" | "csv"): Promise<number> {
      if (rows.length === 0) return 0;
      const db = await getDb();
      for (let i = 0; i < rows.length; i += 500) {
        const body = rows.slice(i, i + 500).map((r) => ({ ...toSnake(r as unknown as Record<string, unknown>), workspace_id: ws, source }));
        const { error } = await (from(db, "campaign_daily_metrics") as unknown as Upserter).upsert(body, { onConflict: "campaign_id,day" });
        throwIfError(error);
      }
      return rows.length;
    },
  };
}
export const metricsRepo = createMetricsRepo();
