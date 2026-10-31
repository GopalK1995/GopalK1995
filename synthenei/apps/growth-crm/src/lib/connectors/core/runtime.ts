// Wires RuntimeDeps for server contexts. Service flavour (jobs, OAuth callback): service-role store + Vault. Request flavour
// (server actions): the signed-in user's client for reads and writes that RLS covers; Vault always goes through the service role.
import "server-only";
import { dbForRequest, type Db } from "@/lib/db/client";
import { serviceDb } from "@/lib/db/service";
import { emitEvent } from "@/lib/events/emit";
import { env } from "@/lib/env";
import type { Logger } from "./types";
import type { RuntimeDeps } from "./ports";
import { supabaseStore } from "./store-supabase";
import { supabaseVault } from "./vault";

/** Vendor settings (client ids, API base overrides) are read from the process environment here and nowhere else in the connector code. */
export const vendorEnv = (): Record<string, string | undefined> => ({ ...process.env });

export const consoleLogger = (prefix = "connector"): Logger => ({
  info: (m, f) => console.info(`[${prefix}]`, m, f ?? {}),
  warn: (m, f) => console.warn(`[${prefix}]`, m, f ?? {}),
  error: (m, f) => console.error(`[${prefix}]`, m, f ?? {}),
});

export function runtimeFromDb(db: Db, log: Logger = consoleLogger()): RuntimeDeps {
  return {
    store: supabaseStore(db, env.appEnv), vault: supabaseVault(db), env: vendorEnv(), log,
    emit: async (e) => { await emitEvent({ type: e.type, objectType: "integration", objectId: e.objectId, workspaceId: e.workspaceId, data: e.data }, db); },
  };
}
export const serviceRuntime = (log: Logger = consoleLogger()): RuntimeDeps => runtimeFromDb(serviceDb(), log);
/** For server actions: store on the user's client (RLS second line), Vault on the service role. */
export async function requestRuntime(audit: RuntimeDeps["audit"], log: Logger = consoleLogger()): Promise<RuntimeDeps> {
  const db = await dbForRequest();
  return { store: supabaseStore(db, env.appEnv), vault: supabaseVault(serviceDb()), env: vendorEnv(), log, audit };
}
