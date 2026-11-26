// The "social" stream of the Meta connector (registered in meta-ads/connector.ts): every 3 hours (Asia/Kolkata) plus "Refresh now".
// Uses T036's connection: tokens, page id and Instagram id come from its credential bundle; assets are tenant-isolated by meta_assets
// (selectMetaAssets). Real mode only: the sandbox token or an APP_ENV=demo run without a token never writes rows (the page shows labelled
// sample data in demo mode instead). The Graph base and version come from META_GRAPH_API_BASE / META_GRAPH_API_VERSION.
import { CredentialError, type StreamDef, type SyncContext, type SyncResult } from "../../core/types";
import { apiBaseOf, apiVersionOf, gatewayFor, isMockCredentials } from "../../meta-ads/config";
import { CRED, META_ENV } from "../../meta-ads/constants";
import { makeOrganicGraph } from "./graph";
import { organicStep, SYNC_CRON } from "./sync";
import type { OrganicGateway, SocialStore } from "./types";

type Env = Record<string, string | undefined>;
export interface OrganicRuntime { env: Env; store: SocialStore; log?: { warn(m: string, f?: Record<string, unknown>): void }; now: () => Date; fetchImpl?: typeof fetch; gateway?: OrganicGateway }

/** Permissions the organic reads need (Meta app review). Missing ones = "needs vendor approval" on the page. */
export const ORGANIC_SCOPES = ["instagram_basic", "instagram_manage_insights", "pages_show_list", "pages_read_engagement", "read_insights"] as const;
export const missingOrganicScopes = (granted: string[]): string[] => (granted.length ? ORGANIC_SCOPES.filter((s) => !granted.includes(s)) : []);

let factory: (() => Promise<OrganicRuntime>) | null = null;
/** Tests inject a runtime built on fakes; production lazily builds the service-role runtime (runtime.ts, server-only). */
export function setOrganicRuntimeFactory(f: (() => Promise<OrganicRuntime>) | null): void { factory = f; }
async function runtime(): Promise<OrganicRuntime> { return factory ? factory() : (await import("./runtime")).organicRuntime(); }

export async function socialRun(ctx: SyncContext, rt?: OrganicRuntime): Promise<SyncResult> {
  const r = rt ?? await runtime();
  const secrets = await ctx.secrets();
  if (!r.gateway && (isMockCredentials(secrets) || (r.env.APP_ENV === "demo" && !secrets[CRED.accessToken]))) {
    return { cursor: null, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "sandbox" }, status: "skipped", reason: "sandbox_credentials" };   // sample data is a page-level, in-memory demo
  }
  const pageId = secrets[CRED.pageId], igUserId = secrets[CRED.igUserId];
  if (!pageId && !igUserId) return { cursor: null, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "no_accounts" }, status: "skipped", reason: "no_page_or_instagram_selected" };

  if (!r.gateway) {
    // Availability gate: the token must carry the insights permissions. A dead token is needs_attention; any other failure here does not block.
    try {
      const dbg = await gatewayFor({ connectionId: ctx.conn.id, secrets, env: r.env, fetchImpl: r.fetchImpl }).debugToken();
      if (!dbg.valid) throw new CredentialError("Meta says this access token is no longer valid");
      const missing = missingOrganicScopes(dbg.scopes);
      if (missing.length) return { cursor: null, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "needs_vendor_approval", missing_scopes: missing }, status: "skipped", reason: `missing_scopes:${missing.join("|")}` };
    } catch (e) { if (e instanceof CredentialError) throw e; }
  }
  const gateway = r.gateway ?? makeOrganicGraph({
    apiBase: apiBaseOf(r.env), version: apiVersionOf(r.env), pageToken: secrets[CRED.pageToken], pageId, igUserId,
    appSecret: (r.env[META_ENV.appSecret] ?? "").trim() || undefined, fetch: r.fetchImpl,
  });
  return organicStep({ store: r.store, gateway, now: r.now, log: r.log }, { tenantId: ctx.conn.tenantId, workspaceId: ctx.conn.workspaceId, connectionId: ctx.conn.id, igUserId, pageId }, (reason) => ctx.reject?.(reason));
}

export const socialStream: StreamDef = { key: "social", schedule: { cron: SYNC_CRON, tz: "Asia/Kolkata" }, run: (ctx) => socialRun(ctx) };
