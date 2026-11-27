"use server";
// Social page actions: account selection after the Meta OAuth (listMetaAssets / selectMetaAssets from T036, which enforce workspace
// ownership of the connection and platform-wide page/Instagram ownership through meta_assets) and "Refresh now". Every action asserts
// integrations.manage; demo sessions never touch Meta or the database.
import "@/lib/connectors/all";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { actorFromPrincipal, audit } from "@/lib/audit/record";
import { requestRuntime } from "@/lib/connectors/core/runtime";
import { isRunnable } from "@/lib/connectors/core/sync";
import { connectMetaPages, listMetaAssets, removeMetaPage, retryWebhookSubscription, supabaseMetaStore, type AssetFail } from "@/lib/connectors/meta-ads";
import { serviceDb } from "@/lib/db/service";
import { getT } from "@/i18n/server";
import { enqueue } from "@/lib/jobs/registry";
import { manageCtx, type IntCtx } from "../../integrations/_lib/ctx";
import { getIntT } from "../../integrations/_lib/strings";

const id = z.string().min(1).max(64);
export interface PageChoice { id: string; name: string; igUsername?: string }
/** One requested Page after a save: added, or why not (translated). */
export interface PageResult { id: string; name: string; ok: boolean; message: string }
export interface AdChoice { id: string; name: string }

const FAIL: Record<AssetFail, string> = {
  not_found: "pickFailNotFound", not_connected: "pickFailNotConnected", not_configured: "pickFailNotConfigured", token_rejected: "pickFailToken",
  page_not_managed: "pickFailNotManaged", ad_account_not_available: "pickFailOther", page_taken: "pickFailTaken", ig_taken: "pickFailTaken", vault_failed: "pickFailOther", audit_failed: "pickFailOther",
};
const rt = (c: IntCtx) => requestRuntime(async (e) => {
  await audit(actorFromPrincipal(c.principal), { action: e.action, summary: e.summary, object: { table: "integrations", id: e.connectionId }, detail: e.detail });
});

/** The Pages (with their linked Instagram account) and ad accounts the connected Meta user can pick from. Names and ids only. */
export async function listSocialAssets(connectionId: string): Promise<ActionResult<{ pages: PageChoice[]; adAccounts: AdChoice[]; connected: string[] }>> {
  return runAction(async () => {
    const cid = id.parse(connectionId), c = await manageCtx(), t = await getT("social");
    if (c.demo) return okResult("", { data: { pages: [{ id: "demo-page", name: "Sample studio (Page)", igUsername: "sample.studio" }], adAccounts: [], connected: [] } });
    const r = await listMetaAssets(await rt(c), { uid: c.uid, tenantId: c.tenant, workspaceId: c.ws }, cid);
    if (!r.ok) return failResult("invalid", t(FAIL[r.code]));
    return okResult("", { data: { pages: r.value.pages.map((p) => ({ id: p.id, name: p.name, igUsername: p.igUsername })), adAccounts: r.value.adAccounts.map((a) => ({ id: a.id, name: a.name })), connected: r.value.connected } });
  });
}

/**
 * AUD-100: adds the chosen Pages (each with its linked Instagram account) to the workspace, next to the ones already connected, then queues a
 * sync. Every Page is judged on its own: the result lists which were added and why the others were not, and the call succeeds when at least one was.
 */
export async function selectSocialAssets(connectionId: string, pageIds: string[], adAccountId?: string): Promise<ActionResult<{ pageName: string; results: PageResult[] }>> {
  return runAction(async () => {
    const i = z.object({ cid: id, pageIds: z.array(id).min(1).max(25), ad: id.optional() }).parse({ cid: connectionId, pageIds, ad: adAccountId || undefined });
    const c = await manageCtx(), t = await getT("social");
    if (c.demo) return okResult(t("pickDone", { name: "Sample studio" }), { data: { pageName: "Sample studio", results: [{ id: "demo-page", name: "Sample studio", ok: true, message: "" }] } });
    // meta_assets is written by the service role only; the caller was authorised by manageCtx and the connection check inside connectMetaPages.
    const r = await connectMetaPages(await rt(c), supabaseMetaStore(serviceDb()), { uid: c.uid, tenantId: c.tenant, workspaceId: c.ws }, i.cid, { pageIds: i.pageIds, adAccountId: i.ad });
    if (!r.ok) return failResult(r.code === "page_taken" || r.code === "ig_taken" ? "conflict" : "invalid", t(FAIL[r.code]));
    const names = new Map(r.value.pages.map((p) => [p.id, p.name ?? p.id]));
    const results: PageResult[] = r.value.results.map((x) => ({ id: x.pageId, name: x.ok ? x.pageName : names.get(x.pageId) ?? x.pageId, ok: x.ok, message: x.ok ? "" : t(FAIL[x.code]) }));
    await enqueue("connector_sync", "connector.sync", { connection_id: i.cid, stream: "social", trigger: "manual", started_by: c.uid, dedupe: `social:${i.cid}:${Date.now()}` }, { tenantId: c.tenant });
    revalidatePath("/analytics/social");
    revalidatePath("/integrations/meta-ads");
    const added = results.filter((x) => x.ok);
    const msg = added.length === 1 ? t("pickDone", { name: added[0]!.name }) : t("pickDoneMany", { count: added.length });
    return okResult(results.some((x) => !x.ok) ? `${msg} ${t("pickSomeFailed", { count: results.length - added.length })}` : msg, { data: { pageName: added[0]!.name, results } });
  });
}

/** Stops tracking one Page (and its Instagram account); the other accounts, the Meta login and the numbers already collected stay. */
export async function removeSocialAccount(connectionId: string, pageId: string): Promise<ActionResult<{ remaining: number }>> {
  return runAction(async () => {
    const i = z.object({ cid: id, pageId: id }).parse({ cid: connectionId, pageId });
    const c = await manageCtx(), t = await getT("social");
    if (c.demo) return okResult(t("pickRemoved"), { data: { remaining: 0 } });
    const r = await removeMetaPage(await rt(c), supabaseMetaStore(serviceDb()), { uid: c.uid, tenantId: c.tenant, workspaceId: c.ws }, i.cid, i.pageId);
    if (!r.ok) return failResult(r.code === "not_found" ? "not_found" : "invalid", t(FAIL[r.code]));
    revalidatePath("/analytics/social");
    revalidatePath("/integrations/meta-ads");
    return okResult(t("pickRemoved"), { data: { remaining: r.value.remaining } });
  });
}

/** Queues a manual sync of the social stream only. A run already in flight for the stream is skipped by the runner. */
export async function refreshSocialNow(connectionId: string): Promise<ActionResult> {
  return runAction(async () => {
    const cid = id.parse(connectionId), c = await manageCtx(), t = await getT("social");
    if (c.demo) return okResult(t("refreshQueued"), { sub: t("sampleBand") });
    const conn = await (await rt(c)).store.getConnection(cid);
    if (!conn || conn.workspaceId !== c.ws || !isRunnable(conn)) return failResult("not_found", t("pickFailNotConnected"));
    await enqueue("connector_sync", "connector.sync", { connection_id: cid, stream: "social", trigger: "manual", started_by: c.uid, dedupe: `social:${cid}:${Date.now()}` }, { tenantId: c.tenant });
    revalidatePath("/analytics/social");
    return okResult(t("refreshQueued"), { sub: t("refreshQueuedSub") });
  });
}

/** Re-runs the Meta webhook subscription for the connection (INTG-011): the integration page shows when it failed and offers this. */
export async function retryMetaWebhook(connectionId: string): Promise<ActionResult<{ subscribed: boolean }>> {
  return runAction(async () => {
    const cid = id.parse(connectionId), c = await manageCtx(), t = await getIntT();
    if (c.demo) return okResult(t("metaHealth.retryOk"), { data: { subscribed: true } });
    const r = await retryWebhookSubscription(await rt(c), supabaseMetaStore(serviceDb()), { uid: c.uid, tenantId: c.tenant, workspaceId: c.ws }, cid);
    if (!r.ok) return failResult("not_found", (await getT("social"))(FAIL[r.code]));
    revalidatePath("/integrations/meta-ads");
    if (!r.value.subscribed) return failResult("error", t("metaHealth.retryStill"));
    return okResult(t("metaHealth.retryOk"), { data: { subscribed: true } });
  });
}
