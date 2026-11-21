// Service-role wiring for the CRM sync engine (jobs and webhook consumers only). Server only.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { env } from "@/lib/env";
import { consoleLogger, vendorEnv } from "../../core/runtime";
import { supabaseStore } from "../../core/store-supabase";
import type { CrmRuntime } from "./kit";
import { supabaseCrmStore } from "./store-supabase";

export async function crmRuntime(): Promise<CrmRuntime> {
  const db = serviceDb();
  return { store: supabaseCrmStore(db, supabaseStore(db, env.appEnv)), env: vendorEnv(), log: consoleLogger("crm-sync"), now: () => new Date() };
}
