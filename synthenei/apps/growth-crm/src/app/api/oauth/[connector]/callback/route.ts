// GET /api/oauth/[connector]/callback?code&state
// Verifies the signed cookie + state + user + workspace, consumes the one-time state, exchanges the code (PKCE verifier from the
// cookie), puts the tokens in the Vault and flips the connection. The code, tokens and verifier are never logged or put in a URL.
import { NextResponse, type NextRequest } from "next/server";
import { requireActive } from "@/lib/auth/server";
import { AuthzError } from "@/lib/authz";
import { assertCan } from "@/lib/authz/load";
import { actorFromPrincipal, audit } from "@/lib/audit/record";
import { completeOAuth } from "@/lib/connectors/core/lifecycle";
import { cookieName, exchangeCode, resolveRedirectUri, safeReturnPath } from "@/lib/connectors/core/oauth";
import { checkCallback } from "@/lib/connectors/core/oauth-flow";
import { CredentialError, TransientError } from "@/lib/connectors/core/types";
import { runtimeFromDb, vendorEnv } from "@/lib/connectors/core/runtime";
import { getConnector, isUsableIn } from "@/lib/connectors/registry";
import { dbForRequest } from "@/lib/db/client";
import { serviceDb } from "@/lib/db/service";
import { from } from "@/lib/db/query";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function done(req: NextRequest, connector: string, query: string, returnTo?: string) {
  const path = safeReturnPath(returnTo, `/integrations/${encodeURIComponent(connector)}`);
  const res = NextResponse.redirect(new URL(`${path}?${query}`, req.url), { status: 303, headers: { "cache-control": "no-store" } });
  res.cookies.set(cookieName(connector), "", { httpOnly: true, path: "/api/oauth", maxAge: 0 });   // the cookie is single use either way
  return res;
}
const fail = (req: NextRequest, connector: string, code: string) => done(req, connector, `error=${code}`);

export async function GET(req: NextRequest, ctx: { params: Promise<{ connector: string }> }) {
  const { connector } = await ctx.params;
  if (env.demoMode || !env.supabaseConfigured) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { session, active } = await requireActive();
  if (session.demo) return NextResponse.json({ error: "not found" }, { status: 404 });
  let principal;
  try { principal = await assertCan("integrations.manage"); } catch (e) { if (e instanceof AuthzError) return fail(req, connector, "denied"); throw e; }

  const def = getConnector(connector);
  const secret = env.sessionSecret;
  if (!def?.oauth || def.auth !== "oauth2" || !isUsableIn(def, env.appEnv) || !secret) return fail(req, connector, "unknown_connector");

  const sp = req.nextUrl.searchParams;
  const svc = serviceDb();
  const check = await checkCallback({
    connector, query: { code: sp.get("code"), state: sp.get("state"), error: sp.get("error") }, cookieToken: req.cookies.get(cookieName(connector))?.value, secret,
    uid: session.uid, activeWs: active.ws.uuid,
    consumeState: async (hash) => {
      const r = await from(svc, "oauth_states").select("state_hash").eq("state_hash", hash).gt("expires_at" as never, new Date().toISOString());
      if (r.error || !((r.data as unknown[] | null) ?? []).length) return false;
      const del = await (from(svc, "oauth_states") as unknown as { delete(): { eq(c: string, v: string): PromiseLike<{ error: unknown }> } }).delete().eq("state_hash", hash);
      return !del.error;
    },
  });
  if (!check.ok) return fail(req, connector, check.reason === "denied" ? "oauth_denied" : check.reason === "expired" ? "oauth_expired" : check.reason === "state_mismatch" || check.reason === "state_replayed" ? "oauth_state" : "oauth_failed");

  const vEnv = vendorEnv();
  const redirectUri = resolveRedirectUri({ OAUTH_REDIRECT_URIS: vEnv.OAUTH_REDIRECT_URIS, APP_BASE_URL: env.appBaseUrl }, connector);
  if (!redirectUri) return fail(req, connector, "redirect_not_allowed");
  try {
    const tokens = await exchangeCode(def.oauth, { code: check.code, redirectUri, clientId: vEnv[def.oauth.clientIdEnv] ?? "", clientSecret: vEnv[def.oauth.clientSecretEnv] ?? "", verifier: check.cookie.verifier });
    const tenant = await from(await dbForRequest(), "workspaces").select("tenant_id").eq("id", active.ws.uuid).maybeSingle();
    const tenantId = (tenant.data as { tenant_id?: string } | null)?.tenant_id;
    if (!tenantId) return fail(req, connector, "oauth_failed");
    const rt = { ...runtimeFromDb(svc), audit: async (e: { action: string; summary: string; connectionId: string; detail?: Record<string, unknown> }) => { await audit(actorFromPrincipal(principal), { action: e.action, summary: e.summary, object: { table: "integrations", id: e.connectionId }, detail: e.detail }); } };
    const r = await completeOAuth(rt, { uid: session.uid, tenantId, workspaceId: active.ws.uuid }, connector, tokens);
    if (!r.ok) return fail(req, connector, r.code);
    return done(req, connector, "connected=1", check.cookie.returnTo);
  } catch (e) {
    return fail(req, connector, e instanceof CredentialError ? "oauth_denied" : e instanceof TransientError ? "oauth_failed" : "oauth_failed");
  }
}
