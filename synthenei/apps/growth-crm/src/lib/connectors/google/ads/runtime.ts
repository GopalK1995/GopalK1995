// Service-role wiring for the Google Ads connector (scheduled jobs). Server only.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { consoleLogger, vendorEnv } from "../../core/runtime";
import type { AdsRuntime } from "./connector";
import { supabaseAdsStore } from "./store-supabase";

export async function adsRuntime(): Promise<AdsRuntime> {
  return { env: vendorEnv(), deps: { store: supabaseAdsStore(serviceDb()), log: consoleLogger("google-ads"), now: () => new Date() } };
}
