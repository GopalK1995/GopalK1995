// Service-role wiring for the GA4 connector (scheduled jobs). Server only.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { consoleLogger, vendorEnv } from "../../core/runtime";
import type { Ga4Runtime } from "./connector";
import { supabaseGa4Store } from "./store-supabase";

export async function ga4Runtime(): Promise<Ga4Runtime> {
  return { env: vendorEnv(), deps: { store: supabaseGa4Store(serviceDb()), log: consoleLogger("ga4"), now: () => new Date() } };
}
