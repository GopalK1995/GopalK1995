// Service-role wiring for the Business Profile connector (scheduled jobs). Server only.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { consoleLogger, vendorEnv } from "../../core/runtime";
import type { GbpRuntime } from "./connector";
import { supabaseGbpStore } from "./store-supabase";

export async function gbpRuntime(): Promise<GbpRuntime> {
  return { env: vendorEnv(), deps: { store: supabaseGbpStore(serviceDb()), log: consoleLogger("google-business"), now: () => new Date() } };
}
