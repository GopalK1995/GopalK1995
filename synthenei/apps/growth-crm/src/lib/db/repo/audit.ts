import { dbForRequest } from "../client";
import { makeRepo, type DbProvider } from "./base";
import type { AuditRow } from "./types";

/** Read-only: the audit log is append-only and written by triggers. */
export function createAuditRepo(getDb: DbProvider = dbForRequest) {
  const r = makeRepo<AuditRow & { id: string }, Record<string, never>>({ table: "audit_log", orderCol: "occurred_at" }, getDb);
  return { list: r.list };
}

export const auditRepo = createAuditRepo();
