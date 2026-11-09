// Service-role wiring for the email connector (jobs, webhook consumer and the public unsubscribe endpoint only). Server only.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { rateLimit } from "@/lib/security/rate-limit";
import { consoleLogger, serviceRuntime, vendorEnv } from "../core/runtime";
import type { EmailRuntime } from "./connector";
import { EMAIL_ENV } from "./constants";
import { supabaseEmailStore } from "./store-supabase";

export async function serviceEmailRuntime(): Promise<EmailRuntime> {
  const db = serviceDb(), env = vendorEnv(), log = consoleLogger("email");
  return {
    env, core: serviceRuntime(),
    deps: {
      store: supabaseEmailStore(db, (m) => log.warn(m)), log, now: () => new Date(),
      rate: async (key, limit, windowMs) => (await rateLimit("email", key, { limit, windowMs })).ok,
      baseUrl: (env[EMAIL_ENV.appBaseUrl] ?? "").trim(), unsubscribeSecret: (env[EMAIL_ENV.unsubscribeSecret] ?? "").trim(),
    },
  };
}
