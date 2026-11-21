// Service-role wiring for the organic stream (jobs only). Server only.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { consoleLogger, vendorEnv } from "../../core/runtime";
import type { OrganicRuntime } from "./stream";
import { supabaseSocialStore } from "./store-supabase";

export async function organicRuntime(): Promise<OrganicRuntime> {
  return { env: vendorEnv(), store: supabaseSocialStore(serviceDb()), log: consoleLogger("meta-organic"), now: () => new Date() };
}
