// Personal-data breach register (DPDP). One row per incident: what happened, what data, how many people, and the two notifications the Act
// asks for (the Data Protection Board and each affected person). Table public.breach_register is a T052 need (docs/migrations-backlog.md);
// until it exists the page says so and nothing is stored. Pure helpers + a small repo on the signed-in user's client (RLS: owners).
import type { Db } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import { mapPgError } from "@/lib/db/errors";
import { addHoursIso } from "@/lib/datetime";

type R = Record<string, unknown>;
export const BREACH_STATUSES = ["open", "contained", "closed"] as const;
export type BreachStatus = (typeof BREACH_STATUSES)[number];
export const BREACH_SEVERITIES = ["low", "medium", "high"] as const;
export type BreachSeverity = (typeof BREACH_SEVERITIES)[number];
/** Detailed report to the Board follows the first intimation within 72 hours of becoming aware (DPDP Rules, confirm with counsel). */
export const BOARD_REPORT_HOURS = 72;

export interface Breach {
  id: string; detectedAt: string; occurredAt: string | null; summary: string; categories: string[]; affectedCount: number | null;
  severity: BreachSeverity; status: BreachStatus; boardNotifiedAt: string | null; individualsNotifiedAt: string | null; remediation: string | null; createdAt: string;
}
export interface BreachInput {
  detectedAt: string; occurredAt?: string | null; summary: string; categories: string[]; affectedCount?: number | null; severity: BreachSeverity; remediation?: string | null;
}

/** Detection instant (UTC ISO) + 72 elapsed hours. Zone-free: the same instant whatever zone the server or browser runs in. */
export const boardReportDueAt = (detectedAt: string): string => addHoursIso(detectedAt, BOARD_REPORT_HOURS);
export type NotifyState = "done" | "overdue" | "pending";
export function boardState(b: Pick<Breach, "detectedAt" | "boardNotifiedAt" | "status">, now: number): NotifyState {
  if (b.boardNotifiedAt) return "done";
  return new Date(boardReportDueAt(b.detectedAt)).getTime() < now ? "overdue" : "pending";
}

export type MissingTable = { missing: true };
const isMissing = (e: { code?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205");

export function mapBreach(r: R): Breach {
  const sev = BREACH_SEVERITIES.includes(r.severity as BreachSeverity) ? (r.severity as BreachSeverity) : "medium";
  const st = BREACH_STATUSES.includes(r.status as BreachStatus) ? (r.status as BreachStatus) : "open";
  return {
    id: String(r.id), detectedAt: String(r.detected_at), occurredAt: r.occurred_at ? String(r.occurred_at) : null, summary: String(r.summary ?? ""),
    categories: Array.isArray(r.data_categories) ? (r.data_categories as unknown[]).map(String) : [], affectedCount: typeof r.affected_count === "number" ? r.affected_count : null,
    severity: sev, status: st, boardNotifiedAt: r.board_notified_at ? String(r.board_notified_at) : null,
    individualsNotifiedAt: r.individuals_notified_at ? String(r.individuals_notified_at) : null, remediation: r.remediation ? String(r.remediation) : null, createdAt: String(r.created_at),
  };
}

const COLS = "id, detected_at, occurred_at, summary, data_categories, affected_count, severity, status, board_notified_at, individuals_notified_at, remediation, created_at";
export function breachRepo(db: Db, workspaceId: string) {
  const q = () => from(db, "breach_register");
  return {
    async list(): Promise<Breach[] | MissingTable> {
      const r = await q().select(COLS).eq("workspace_id", workspaceId).order("detected_at", { ascending: false }).limit(200);
      if (isMissing(r.error)) return { missing: true };
      const e = mapPgError(r.error); if (e) throw e;
      return ((r.data as R[] | null) ?? []).map(mapBreach);
    },
    async add(i: BreachInput): Promise<string> {
      const r = await q().insert({
        workspace_id: workspaceId, detected_at: i.detectedAt, occurred_at: i.occurredAt ?? null, summary: i.summary, data_categories: i.categories,
        affected_count: i.affectedCount ?? null, severity: i.severity, remediation: i.remediation ?? null,
      }).select("id");
      const e = mapPgError(r.error); if (e) throw e;
      return String(((r.data as R[] | null) ?? [])[0]?.id ?? "");
    },
    async update(id: string, patch: { status?: BreachStatus; boardNotifiedAt?: string | null; individualsNotifiedAt?: string | null; remediation?: string | null }): Promise<void> {
      const p: R = {};
      if (patch.status) p.status = patch.status;
      if ("boardNotifiedAt" in patch) p.board_notified_at = patch.boardNotifiedAt;
      if ("individualsNotifiedAt" in patch) p.individuals_notified_at = patch.individualsNotifiedAt;
      if ("remediation" in patch) p.remediation = patch.remediation;
      const r = await q().update(p).eq("id", id).eq("workspace_id", workspaceId).select("id");
      const e = mapPgError(r.error); if (e) throw e;
    },
  };
}
