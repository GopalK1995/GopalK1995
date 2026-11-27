// The "social" stream of the Meta connector (registered in meta-ads/connector.ts): every 3 hours (Asia/Kolkata) plus "Refresh now".
// Uses T036's connection: tokens, page id and Instagram id come from its credential bundle; assets are tenant-isolated by meta_assets
// (selectMetaAssets). Real mode only: the sandbox token or an APP_ENV=demo run without a token never writes rows (the page shows labelled
// sample data in demo mode instead). The Graph base and version come from META_GRAPH_API_BASE / META_GRAPH_API_VERSION.
import { CredentialError, type StreamDef, type SyncContext, type SyncResult } from "../../core/types";
import { apiBaseOf, apiVersionOf, gatewayFor, isMockCredentials } from "../../meta-ads/config";
import { CRED, META_ENV } from "../../meta-ads/constants";
import { pagesOf, type PageEntry } from "../../meta-ads/pages";
import { makeOrganicGraph } from "./graph";
import { organicStep, SYNC_CRON } from "./sync";
import type { OrganicGateway, SocialStore } from "./types";

type Env = Record<string, string | undefined>;
export interface OrganicRuntime { env: Env; store: SocialStore; log?: { warn(m: string, f?: Record<string, unknown>): void }; now: () => Date; fetchImpl?: typeof fetch; gateway?: OrganicGateway; /** test hook (AUD-100): a gateway per Page */ gatewayFor?: (page: PageEntry) => OrganicGateway }

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
  if (!r.gateway && !r.gatewayFor && (isMockCredentials(secrets) || (r.env.APP_ENV === "demo" && !secrets[CRED.accessToken]))) {
    return { cursor: null, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "sandbox" }, status: "skipped", reason: "sandbox_credentials" };   // sample data is a page-level, in-memory demo
  }
  const pages = pagesOf(secrets);
  if (!pages.length) return { cursor: null, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "no_accounts" }, status: "skipped", reason: "no_page_or_instagram_selected" };

  if (!r.gateway && !r.gatewayFor) {
    // Availability gate: the token must carry the insights permissions. A dead token is needs_attention; any other failure here does not block.
    try {
      const dbg = await gatewayFor({ connectionId: ctx.conn.id, secrets, env: r.env, fetchImpl: r.fetchImpl }).debugToken();
      if (!dbg.valid) throw new CredentialError("Meta says this access token is no longer valid");
      const missing = missingOrganicScopes(dbg.scopes);
      if (missing.length) return { cursor: null, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "needs_vendor_approval", missing_scopes: missing }, status: "skipped", reason: `missing_scopes:${missing.join("|")}` };
    } catch (e) { if (e instanceof CredentialError) throw e; }
  }
  const appSecret = (r.env[META_ENV.appSecret] ?? "").trim() || undefined;
  const stepFor = (p: PageEntry) => organicStep(
    { store: r.store, gateway: r.gatewayFor?.(p) ?? r.gateway ?? makeOrganicGraph({ apiBase: apiBaseOf(r.env), version: apiVersionOf(r.env), pageToken: p.token, pageId: p.id, igUserId: p.igUserId, appSecret, fetch: r.fetchImpl }), now: r.now, log: r.log },
    { tenantId: ctx.conn.tenantId, workspaceId: ctx.conn.workspaceId, connectionId: ctx.conn.id, igUserId: p.igUserId, pageId: p.id }, (reason) => ctx.reject?.(reason));
  // One Page: exactly the single-account run it always was (same result, same errors).
  if (pages.length === 1) return stepFor(pages[0]!);

  // AUD-100: several Pages. Each runs on its own token and fails on its own: the others still sync, the failed one is recorded on its own
  // account rows (needs_attention / error) and named in the run note. Only when EVERY Page failed does the run fail as a whole.
  const results: { page: PageEntry; res?: SyncResult; err?: unknown }[] = [];
  for (const page of pages) {
    try { results.push({ page, res: await stepFor(page) }); }
    catch (err) {
      results.push({ page, err });
      const credential = err instanceof CredentialError;
      r.log?.warn("organic sync failed for one account", { page: page.id, kind: credential ? "credential" : "error" });
      await r.store.markFailed?.({ tenantId: ctx.conn.tenantId, workspaceId: ctx.conn.workspaceId, connectionId: ctx.conn.id }, [{ platform: "facebook", externalId: page.id }, ...(page.igUserId ? [{ platform: "instagram" as const, externalId: page.igUserId }] : [])], credential ? "needs_attention" : "error", credential ? "Meta rejected the saved credentials" : "Sync stopped", r.now().toISOString()).catch(() => undefined);
    }
  }
  const failed = results.filter((x) => x.err !== undefined), ok = results.filter((x) => x.res);
  if (!ok.length) throw failed[0]!.err;
  const parts = ok.map((x) => x.res!);
  const statuses = parts.map((x) => x.status);
  const status: SyncResult["status"] = failed.length || statuses.includes("partial") ? "partial" : statuses.every((x) => x === "no_data") ? "no_data" : statuses.every((x) => x === "skipped") ? "skipped" : undefined;
  const failNote = failed.map((x) => `page_${x.page.id}:${x.err instanceof CredentialError ? "credentials_rejected" : "sync_failed"}`);
  const notes = [...failNote, ...parts.map((x) => x.reason).filter((x): x is string => !!x)];
  return {
    cursor: parts[0]!.cursor, rowsIn: parts.reduce((n, x) => n + x.rowsIn, 0), rowsRejected: parts.reduce((n, x) => n + x.rowsRejected, 0) + failed.length, done: true,
    ...(status ? { status, reason: notes.slice(0, 4).join(",") || undefined } : {}),
    sample: { accounts: results.map((x) => ({ page: x.page.id, ok: x.err === undefined, ...(x.err !== undefined ? { error: x.err instanceof CredentialError ? "credentials_rejected" : "sync_failed" } : { sample: x.res!.sample }) })) },
  };
}

export const socialStream: StreamDef = { key: "social", schedule: { cron: SYNC_CRON, tz: "Asia/Kolkata" }, run: (ctx) => socialRun(ctx) };
