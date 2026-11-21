// Service-role wiring for the iCal connector (poll stream, test action, public feed route). Server only.
// System audit rows (a feed failing) go through the audit_record RPC as a connector actor; a person-started action replaces `audit`
// with the signed-in actor's writer (audit or nothing). A failed system audit is logged and does not stop the sync: the sync_runs row,
// integrations.last_error and the owner notification already record the same fact.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { supabaseBookingRecordStore } from "../channel-manager/store-supabase";
import { consoleLogger } from "../core/runtime";
import { supabaseVault } from "../core/vault";
import { makeFeedFetcher } from "./fetcher";
import type { IcalDeps } from "./store";
import { supabaseIcalStore } from "./store-supabase";

type Rpc = { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ error: { message?: string } | null }> };

export function icalServiceDeps(workspaceId: string | null = null): IcalDeps {
  const db = serviceDb();
  const log = consoleLogger("ical");
  return {
    store: supabaseIcalStore(db, supabaseVault(db)), records: supabaseBookingRecordStore(db), fetch: makeFeedFetcher(), log, now: () => new Date(),
    async audit(e) {
      const { error } = await (db as unknown as Rpc).rpc("audit_record", {
        p_workspace: workspaceId, p_action: e.action, p_summary: e.summary.slice(0, 300), p_object_table: null, p_object_id: null, p_reason: null, p_detail: e.detail ?? {},
        p_source: "connector", p_actor_kind: "connector", p_request_id: null, p_ip: null, p_user_agent: null, p_impersonation: false,
      });
      if (error) throw new Error("audit write failed");
    },
  };
}
