// Service-role wiring for the Razorpay connector (webhook consumer and server actions). Server only.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { consoleLogger, vendorEnv } from "../core/runtime";
import type { RzpRuntime } from "./connector";
import { supabaseRzpStore } from "./store-supabase";

export async function razorpayServiceRuntime(): Promise<RzpRuntime> {
  return { env: vendorEnv(), deps: { store: supabaseRzpStore(serviceDb()), log: consoleLogger("razorpay"), now: () => new Date() } };
}
