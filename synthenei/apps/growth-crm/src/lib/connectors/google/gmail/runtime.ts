// Service-role wiring for the Gmail connector (scheduled jobs). Server only.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { consoleLogger, vendorEnv } from "../../core/runtime";
import type { GmailRuntime } from "./connector";
import { supabaseGmailStore } from "./store-supabase";

export async function gmailRuntimeFromService(): Promise<GmailRuntime> {
  return { env: vendorEnv(), deps: { store: supabaseGmailStore(serviceDb()), log: consoleLogger("gmail"), now: () => new Date() } };
}
