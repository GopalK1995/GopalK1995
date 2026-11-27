// Writing consent_log rows and registering notice texts, tolerant of migration 0032 not being applied yet.
// The four evidence columns and the notice_versions table arrive with 0032. Before that the same insert, minus the evidence, is exactly
// what the app did yesterday, so nothing breaks when the migration is applied later than the deploy (or never).
import type { Db } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import { EVIDENCE_COLUMN_NAMES, type NoticeSnapshot } from "./evidence";

type R = Record<string, unknown>;
type Err = { code?: string; message?: string } | null;
/** PostgREST: column or table not in the schema cache; Postgres: undefined column or table; undefined function. */
export const NOT_APPLIED = new Set(["PGRST204", "PGRST205", "PGRST202", "42703", "42P01", "42883"]);
export const notApplied = (e: Err): boolean => !!e && NOT_APPLIED.has(String(e.code ?? ""));

const strip = (rows: R[]): R[] => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !(EVIDENCE_COLUMN_NAMES as readonly string[]).includes(k))));

/**
 * Inserts consent rows. Tries with the evidence columns first. A missing column (0032 not applied) retries without them; a foreign-key
 * miss on the notice hash (the text was not registered) retries with the hash dropped but the rest of the evidence kept.
 * Returns whether the evidence went in, so callers and tests can say so honestly.
 */
export async function insertConsentRows(db: Db, rows: R[], opts: { select?: boolean } = {}): Promise<{ error: Err; evidence: boolean; data: unknown }> {
  if (!rows.length) return { error: null, evidence: true, data: [] };
  const run = (r: R[]) => { const q = from(db, "consent_log").insert(r); return opts.select ? q.select("id") : q; };
  let res = await run(rows);
  if (!res.error) return { error: null, evidence: true, data: res.data };
  if (String(res.error.code ?? "") === "23503" && rows.some((r) => r.notice_sha256)) {
    res = await run(rows.map((r) => ({ ...r, notice_sha256: null })));
    if (!res.error) return { error: null, evidence: true, data: res.data };
  }
  if (notApplied(res.error)) {
    res = await run(strip(rows));
    return { error: res.error as Err, evidence: false, data: res.data };
  }
  return { error: res.error as Err, evidence: false, data: null };
}

/**
 * Records the notice text a consent row cites. Service client (the table is service-write). Idempotent: an existing hash is fine.
 * "unsupported" means the table is not there yet (0032 pending): the caller keeps the version label and writes no hash.
 */
export async function registerNotice(svc: Db, tenantId: string, snap: NoticeSnapshot): Promise<"ok" | "unsupported" | "failed"> {
  try {
    const r = await from(svc, "notice_versions").insert({ tenant_id: tenantId, text_sha256: snap.sha256, version: snap.version, text_snapshot: snap.text });
    if (!r.error || String(r.error.code ?? "") === "23505") return "ok";
    return notApplied(r.error as Err) ? "unsupported" : "failed";
  } catch { return "failed"; }
}
