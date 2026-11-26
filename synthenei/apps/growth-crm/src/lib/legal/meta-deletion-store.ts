// Service-role implementation of DeletionStore + the route's dependency wiring. Server only.
import "server-only";
import { from } from "@/lib/db/query";
import { serviceDb } from "@/lib/db/service";
import { disconnect } from "@/lib/connectors/core/lifecycle";
import { consoleLogger, serviceRuntime } from "@/lib/connectors/core/runtime";
import { META_ENV } from "@/lib/connectors/meta-ads/constants";
import { env } from "@/lib/env";
import { CODE_RE, NotConfiguredError, isMissingTable, type DeletionDeps, type DeletionRow, type DeletionStatus, type DeletionStore } from "./meta-deletion";
import type { Db } from "@/lib/db/client";

type R = Record<string, unknown>;
const COLS = "id, confirmation_code, meta_user_id, status, requested_at, completed_at";
const toRow = (r: R): DeletionRow => ({
  id: String(r.id), confirmationCode: String(r.confirmation_code), metaUserId: String(r.meta_user_id), status: String(r.status) as DeletionStatus,
  requestedAt: String(r.requested_at), completedAt: typeof r.completed_at === "string" ? r.completed_at : null,
});
const fail = (what: string, code: unknown): Error => (isMissingTable(code) ? new NotConfiguredError("meta_deletion_requests (apply migration 0024)") : new Error(`meta deletion store: ${what} failed`));

export function supabaseDeletionStore(db: Db): DeletionStore {
  const q = (t: string) => from(db, t);
  return {
    async openRequestFor(metaUserId) {
      const { data, error } = await q("meta_deletion_requests").select(COLS).eq("meta_user_id", metaUserId).neq("status", "completed").order("requested_at", { ascending: false }).limit(1);
      if (error) throw fail("lookup", error.code);
      const r = ((data as R[] | null) ?? [])[0];
      return r ? toRow(r) : null;
    },
    async insert(i) {
      const { data, error } = await q("meta_deletion_requests").insert({ confirmation_code: i.confirmationCode, meta_user_id: i.metaUserId }).select(COLS).single();
      if (error || !data) throw fail("insert", error?.code);
      return toRow(data as R);
    },
    async setStatus(id, status) {
      const { error } = await q("meta_deletion_requests").update({ status, ...(status === "completed" ? { completed_at: new Date().toISOString() } : {}) }).eq("id", id);
      if (error) throw fail("update", error.code);
    },
    async byCode(code) {
      if (!CODE_RE.test(code)) return null;
      const { data, error } = await q("meta_deletion_requests").select(COLS).eq("confirmation_code", code).maybeSingle();
      if (error) throw fail("status lookup", error.code);
      return data ? toRow(data as R) : null;
    },
    // The OAuth flow stores the Page id (not the Facebook user id) as external_account_id, so a Facebook user id can only be matched when a
    // connection's settings carry meta_user_id. Nothing writes that key today: until the connect flow records it, this returns [] and the
    // request stays "received" for the operator to match by hand. Never matched on a guess.
    async connectionsFor(metaUserId) {
      const { data, error } = await q("integrations").select("id").eq("settings->>meta_user_id", metaUserId).neq("status", "disconnected").limit(50);
      if (error) throw fail("connection lookup", error.code);
      return ((data as R[] | null) ?? []).map((r) => String(r.id));
    },
  };
}

/** Wires the route. Throws NotConfiguredError when the service-role client cannot be built. */
export function deletionDeps(): DeletionDeps {
  let db: Db;
  try { db = serviceDb(); } catch { throw new NotConfiguredError("service role"); }
  const log = consoleLogger("meta-deletion");
  const rt = serviceRuntime(log);
  return {
    secret: (process.env[META_ENV.appSecret] ?? "").trim() || undefined,
    store: supabaseDeletionStore(db), baseUrl: env.appBaseUrl ?? "", log,
    disconnect: async (id) => (await disconnect(rt, id, "system:meta-data-deletion")).ok,
  };
}
