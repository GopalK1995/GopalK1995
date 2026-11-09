// Service-role wiring for the Meta connector (jobs and the inbound consumer only). Server only.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/security/rate-limit";
import { consoleLogger, vendorEnv } from "../core/runtime";
import { supabaseStore } from "../core/store-supabase";
import type { MetaRuntime } from "./connector";
import { supabaseMetaStore } from "./store-supabase";

export async function metaRuntime(): Promise<MetaRuntime> {
  const db = serviceDb();
  return {
    env: vendorEnv(),
    deps: {
      store: supabaseMetaStore(db),
      core: supabaseStore(db, env.appEnv),
      log: consoleLogger("meta"),
      now: () => new Date(),
      rate: async (key, limit, windowMs) => (await rateLimit("meta", key, { limit, windowMs })).ok,
    },
  };
}
