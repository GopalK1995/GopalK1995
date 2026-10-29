// Service-role client. Only jobs, vault, inbound webhooks and bot-user minting may use this.
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Db } from "./client";

let cached: Db | null = null;

export function serviceDb(): Db {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("serviceDb: Supabase URL or service credentials are not configured");
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as Db;
  return cached;
}
