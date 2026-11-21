// Service-role wiring for the LinkedIn connector (scheduled jobs). Server only.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { env } from "@/lib/env";
import { consoleLogger, vendorEnv } from "../core/runtime";
import { supabaseStore } from "../core/store-supabase";
import type { LinkedInRuntime } from "./connector";
import { supabaseLinkedInStore } from "./store-supabase";

export async function linkedInRuntime(): Promise<LinkedInRuntime> {
  const db = serviceDb();
  return { env: vendorEnv(), deps: { store: supabaseLinkedInStore(db), core: supabaseStore(db, env.appEnv), log: consoleLogger("linkedin"), now: () => new Date() } };
}
