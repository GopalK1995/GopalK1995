// Public REST API v1 (CONTRACTS C11). Thin route: logic lives in src/lib/api.
import { loadEnv } from "@/lib/env";
import { buildOpenApi } from "@/lib/api/openapi";

export const runtime = "nodejs";

// Public document: no key needed. Absent when Supabase is not configured (demo), like the rest of the API.
export function GET(): Response {
  const e = loadEnv();
  if (!e.supabaseConfigured) return new Response(JSON.stringify({ type: "https://docs.synthan.app/errors/not_found", title: "Not found", status: 404, code: "not_found", detail: "Resource not found." }), { status: 404, headers: { "content-type": "application/problem+json" } });
  return new Response(JSON.stringify(buildOpenApi(e.appBaseUrl)), { headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });
}
