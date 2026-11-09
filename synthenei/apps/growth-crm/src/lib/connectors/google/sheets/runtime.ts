// Service-role wiring for the Sheets import connector (scheduled stream). Server only.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { env } from "@/lib/env";
import { consoleLogger, vendorEnv } from "../../core/runtime";
import { supabaseStore } from "../../core/store-supabase";
import type { SheetsRuntime } from "./connector";
import { supabaseImportPort } from "./import-supabase";

export async function sheetsRuntime(): Promise<SheetsRuntime> {
  const db = serviceDb(), core = supabaseStore(db, env.appEnv);
  return { env: vendorEnv(), deps: { port: supabaseImportPort(db), fieldMap: (id) => core.getFieldMap(id), log: consoleLogger("google-sheets"), now: () => new Date() } };
}
