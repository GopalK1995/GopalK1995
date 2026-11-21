// Service-role wiring for the channel-manager connector (sync streams and the webhook consumer). Server only.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { consoleLogger, vendorEnv } from "../core/runtime";
import type { CmRuntime } from "./connector";
import { genericChannelManager } from "./generic";
import { supabaseBookingRecordStore } from "./store-supabase";

export async function channelManagerServiceRuntime(): Promise<CmRuntime> {
  return { store: supabaseBookingRecordStore(serviceDb()), log: consoleLogger("channel-manager"), now: () => new Date(), env: vendorEnv(), adapter: genericChannelManager };
}
