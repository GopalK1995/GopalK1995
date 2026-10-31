// GET /api/oauth/[connector]/start?ws=<uuid>[&conn=<connection id>]
// Requires integrations.manage (support sessions blocked). Sets a signed, httpOnly cookie holding {state, PKCE verifier, ws, uid}
// for 10 minutes and redirects to the vendor. The one-time state hash is stored in oauth_states (service role).
import { NextResponse, type NextRequest } from "next/server";
import { requireActive } from "@/lib/auth/server";
import { AuthzError } from "@/lib/authz";
import { assertCan } from "@/lib/authz/load";
import { buildAuthorizeUrl, cookieName, OAUTH_COOKIE_TTL_S, pkcePair, randomToken, resolveRedirectUri, signCookie, stateHash } from "@/lib/connectors/core/oauth";
import { vendorEnv } from "@/lib/connectors/core/runtime";
import { supabaseStore } from "@/lib/connectors/core/store-supabase";
import { deriveChip } from "@/lib/connectors/core/status";
import { envConfigured, getConnector, isUsableIn } from "@/lib/connectors/registry";
import { dbForRequest } from "@/lib/db/client";
import { serviceDb } from "@/lib/db/service";
import { from } from "@/lib/db/query";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const back = (req: NextRequest, connector: string, error: string) => NextResponse.redirect(new URL(`/integrations/${encodeURIComponent(connector)}?error=${error}`, req.url), { status: 303, headers: { "cache-control": "no-store" } });

export async function GET(req: NextRequest, ctx: { params: Promise<{ connector: string }> }) {
  const { connector } = await ctx.params;
  if (env.demoMode || !env.supabaseConfigured) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { session, active } = await requireActive();
  if (session.demo) return NextResponse.json({ error: "not found" }, { status: 404 });
  try { await assertCan("integrations.manage"); } catch (e) { if (e instanceof AuthzError) return back(req, connector, "denied"); throw e; }

  const def = getConnector(connector);
  if (!def || def.auth !== "oauth2" || !def.oauth || !isUsableIn(def, env.appEnv)) return back(req, connector, "unknown_connector");
  const ws = req.nextUrl.searchParams.get("ws");
  if (ws !== active.ws.uuid) return back(req, connector, "wrong_workspace");

  const vEnv = vendorEnv();
  const db = await dbForRequest();
  const availability = await supabaseStore(db, env.appEnv).getAvailability(def.id);
  const chip = deriveChip({ availability, connection: null, envConfigured: envConfigured(def, vEnv) });
  if (chip.blockReason) return back(req, connector, chip.blockReason);

  const redirectUri = resolveRedirectUri({ OAUTH_REDIRECT_URIS: vEnv.OAUTH_REDIRECT_URIS, APP_BASE_URL: env.appBaseUrl }, connector);
  const secret = env.sessionSecret;
  if (!redirectUri || !secret) return back(req, connector, "redirect_not_allowed");

  const state = randomToken(24);
  const pkce = def.oauth.pkce ? pkcePair() : null;
  const tenant = await from(db, "workspaces").select("tenant_id").eq("id", active.ws.uuid).maybeSingle();
  const tenantId = (tenant.data as { tenant_id?: string } | null)?.tenant_id;
  if (!tenantId) return back(req, connector, "wrong_workspace");
  const stored = await from(serviceDb(), "oauth_states").insert({ state_hash: stateHash(state), tenant_id: tenantId, workspace_id: active.ws.uuid, connector_id: connector, user_id: session.uid, redirect_to: `/integrations/${connector}`, expires_at: new Date(Date.now() + OAUTH_COOKIE_TTL_S * 1000).toISOString() });
  if (stored.error) return back(req, connector, "oauth_failed");

  const clientId = vEnv[def.oauth.clientIdEnv] ?? "";
  const url = buildAuthorizeUrl(def.oauth, { clientId, redirectUri, state, challenge: pkce?.challenge });
  const res = NextResponse.redirect(url, { status: 303, headers: { "cache-control": "no-store" } });
  res.cookies.set(cookieName(connector), signCookie({ state, verifier: pkce?.verifier ?? null, ws: active.ws.uuid, uid: session.uid, connector, conn: req.nextUrl.searchParams.get("conn"), exp: Date.now() + OAUTH_COOKIE_TTL_S * 1000, returnTo: `/integrations/${connector}` }, secret), {
    httpOnly: true, secure: env.appEnv !== "test" && req.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/oauth", maxAge: OAUTH_COOKIE_TTL_S,
  });
  return res;
}
