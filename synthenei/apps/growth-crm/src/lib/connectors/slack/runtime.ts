// Service-role wiring for the Slack connector (jobs and the webhook handler only). Server only.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { env } from "@/lib/env";
import { emitEvent } from "@/lib/events/emit";
import { rateLimit } from "@/lib/security/rate-limit";
import { consoleLogger, vendorEnv } from "../core/runtime";
import { supabaseStore } from "../core/store-supabase";
import { supabaseVault } from "../core/vault";
import type { SlackDeps } from "./store";
import { supabaseSlackStore } from "./store-supabase";

export function slackDepsFromDb(db: ReturnType<typeof serviceDb>): SlackDeps {
  return {
    store: supabaseSlackStore(db), core: supabaseStore(db, env.appEnv), vault: supabaseVault(db), log: consoleLogger("slack"), now: () => new Date(), env: vendorEnv(),
    rate: async (key, limit, windowMs) => (await rateLimit("slack", key, { limit, windowMs })).ok,
    emit: async (e) => { await emitEvent({ type: e.type, objectType: "integration", objectId: e.objectId, workspaceId: e.workspaceId, data: e.data }, db); },
  };
}
export async function slackRuntime(): Promise<{ deps: SlackDeps }> { return { deps: slackDepsFromDb(serviceDb()) }; }
