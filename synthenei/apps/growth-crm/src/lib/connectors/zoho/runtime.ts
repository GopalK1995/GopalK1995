// Service-role wiring for the Zoho connector (jobs and the inbound consumer only). Server only.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { supabaseVault } from "../core/vault";
import { crmRuntime } from "./engine/runtime";
import type { ZohoRuntime } from "./connector";

export async function zohoRuntime(): Promise<ZohoRuntime> {
  return { ...(await crmRuntime()), vault: supabaseVault(serviceDb()) };
}
