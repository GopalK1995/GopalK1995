// Service-role wiring for the Outlook connector (scheduled jobs and the webhook consumer). Server only.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { consoleLogger, serviceRuntime } from "../core/runtime";
import type { MsRuntime } from "./connector";
import { supabaseMsStore } from "./store-supabase";

export async function serviceMsRuntime(): Promise<MsRuntime> {
  const log = consoleLogger("outlook");
  const rd = serviceRuntime(log);
  return { rd, env: rd.env, deps: { store: supabaseMsStore(serviceDb()), log, now: () => new Date() } };
}
