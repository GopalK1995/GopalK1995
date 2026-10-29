// Request-scoped Supabase client: the signed-in user's JWT via @supabase/ssr, so RLS applies. Throws in demo (no Supabase env).
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "../../../supabase/types";

export type Db = SupabaseClient<Database>;

export async function dbForRequest(): Promise<Db> {
  const c = await createSupabaseServerClient();
  if (!c) throw new Error("dbForRequest: Supabase is not configured (demo mode has no database)");
  return c as unknown as Db;
}
