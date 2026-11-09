"use server";
// Email settings mutations. Every action: zod-validates input, calls assertCan("integrations.manage") (support sessions are blocked
// by the catalogue), has a demo branch that never touches Supabase, checks that the connection belongs to the caller's workspace,
// and never returns or logs a credential. Secrets go to the Vault through the connector framework.
import "@/lib/connectors/all";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorFromPrincipal, audit } from "@/lib/audit/record";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { requestRuntime } from "@/lib/connectors/core/runtime";
import { loadSecrets, saveSecrets } from "@/lib/connectors/core/secrets";
import type { RuntimeDeps } from "@/lib/connectors/core/ports";
import type { ConnectionRow } from "@/lib/connectors/core/types";
import { refreshDomainState, emailRuntime } from "@/lib/connectors/email";
import { enqueueSegmentPush } from "@/lib/connectors/mailchimp/jobs";
import { compileRules, parseStoredRules } from "@/lib/segments/compile";
import { segmentLeadIds } from "@/lib/segments/query";
import { from } from "@/lib/db/query";
import { throwIfError } from "@/lib/db/errors";
import { getEmT } from "@/lib/connectors/email/strings";
import { manageCtx, type IntCtx } from "../../integrations/_lib/ctx";

const SET_KEYS = { fromName: "from_name", fromEmail: "from_email", replyTo: "reply_to", footer: "footer_text", dkimSelector: "dkim_selector" } as const;
const EMAIL = z.string().trim().email().max(254);
const identitySchema = z.object({
  connectionId: z.string().uuid(),
  fromName: z.string().trim().max(80).regex(/^[^\r\n<>"]*$/),
  fromEmail: EMAIL,
  replyTo: z.union([EMAIL, z.literal("")]),
  footer: z.string().trim().max(500),
  dkimSelector: z.string().trim().max(63).regex(/^[A-Za-z0-9._-]*$/),
});
export type IdentityInput = z.infer<typeof identitySchema>;

async function runtimeFor(c: IntCtx): Promise<RuntimeDeps> {
  return requestRuntime(async (e) => { await audit(actorFromPrincipal(c.principal), { action: e.action, summary: e.summary, object: { table: "integrations", id: e.connectionId }, detail: e.detail }); });
}
const demoDone = async (): Promise<ActionResult> => okResult((await getEmT()).t("demoNotSaved"));

/** The connection, only when it is this workspace's and one of the given connectors. Cross-workspace ids look like "not found". */
async function ownConnection(rt: RuntimeDeps, c: IntCtx, id: string, connectors: string[]): Promise<ConnectionRow | null> {
  const conn = await rt.store.getConnection(id);
  return conn && conn.workspaceId === c.ws && connectors.includes(conn.connectorId) ? conn : null;
}

export async function saveIdentity(input: IdentityInput): Promise<ActionResult> {
  return runAction(async () => {
    const v = identitySchema.parse(input);
    const c = await manageCtx(), { t } = await getEmT();
    if (c.demo || !c.db) return demoDone();
    const rt = await runtimeFor(c);
    const conn = await ownConnection(rt, c, v.connectionId, ["resend", "email-smtp"]);
    if (!conn) return failResult("not_found", t("loadErrorBody"));
    const settings = { ...conn.settings, [SET_KEYS.fromName]: v.fromName, [SET_KEYS.fromEmail]: v.fromEmail.toLowerCase(), [SET_KEYS.replyTo]: v.replyTo, [SET_KEYS.footer]: v.footer, [SET_KEYS.dkimSelector]: v.dkimSelector };
    const r = await from(c.db, "integrations").update({ settings }).eq("id", conn.id).eq("workspace_id", c.ws).select("id");
    throwIfError(r.error);
    await audit(actorFromPrincipal(c.principal), { action: "email.identity_changed", summary: "Email sender identity changed", object: { table: "integrations", id: conn.id }, detail: { domain: v.fromEmail.split("@")[1]?.toLowerCase() } });
    revalidatePath("/settings/email");
    return okResult(t("saved"));
  });
}

export async function checkDomain(connectionId: string): Promise<ActionResult> {
  return runAction(async () => {
    const id = z.string().uuid().parse(connectionId);
    const c = await manageCtx(), { t } = await getEmT();
    if (c.demo || !c.db) return demoDone();
    const rt = await runtimeFor(c);
    const conn = await ownConnection(rt, c, id, ["resend", "email-smtp"]);
    if (!conn) return failResult("not_found", t("loadErrorBody"));
    const e = await emailRuntime();   // service runtime: the check needs the Vault; the connection was verified above under the user's RLS
    const r = await refreshDomainState(e, conn, await loadSecrets(e.core.vault, conn));
    revalidatePath("/settings/email");
    if ("skipped" in r) return failResult("invalid", r.skipped === "no_sender" ? t("domainNoSender") : t("domainCheckFailed"));
    return okResult(t("domainChecked"));
  });
}

/** Adds a key to the connection's credential bundle (new Vault secret first, old one removed after), never returning it. */
async function addToBundle(rt: RuntimeDeps, conn: ConnectionRow, key: string, value: string): Promise<void> {
  const bundle = await loadSecrets(rt.vault, conn);
  const id = await saveSecrets(rt.vault, conn.id, { ...bundle, [key]: value }, conn.credentialSecretId);
  await rt.store.updateConnection(conn.id, { credentialSecretId: id });
}
async function markSetting(c: IntCtx, conn: ConnectionRow, patch: Record<string, unknown>): Promise<void> {
  if (!c.db) return;
  throwIfError((await from(c.db, "integrations").update({ settings: { ...conn.settings, ...patch } }).eq("id", conn.id).eq("workspace_id", c.ws).select("id")).error);
}

export async function saveWebhookSecret(connectionId: string, secret: string): Promise<ActionResult> {
  return runAction(async () => {
    const v = z.object({ id: z.string().uuid(), secret: z.string().trim().regex(/^whsec_[A-Za-z0-9+/=_-]{16,200}$/) }).parse({ id: connectionId, secret });
    const c = await manageCtx(), { t } = await getEmT();
    if (c.demo || !c.db) return demoDone();
    const rt = await runtimeFor(c);
    const conn = await ownConnection(rt, c, v.id, ["resend"]);
    if (!conn) return failResult("not_found", t("loadErrorBody"));
    await addToBundle(rt, conn, "webhook_secret", v.secret);
    await markSetting(c, conn, { webhook_secret_set: true });
    await audit(actorFromPrincipal(c.principal), { action: "email.webhook_secret_saved", summary: "Email webhook signing secret saved", object: { table: "integrations", id: conn.id } });
    revalidatePath("/settings/email");
    return okResult(t("webhookSecretSaved"));
  });
}

export async function chooseAudience(connectionId: string, audienceId: string): Promise<ActionResult> {
  return runAction(async () => {
    const v = z.object({ id: z.string().uuid(), audience: z.string().regex(/^[A-Za-z0-9]{4,40}$/) }).parse({ id: connectionId, audience: audienceId });
    const c = await manageCtx(), { t } = await getEmT();
    if (c.demo || !c.db) return demoDone();
    const conn = await ownConnection(await runtimeFor(c), c, v.id, ["mailchimp"]);
    if (!conn) return failResult("not_found", t("loadErrorBody"));
    await markSetting(c, conn, { audience_id: v.audience });
    await audit(actorFromPrincipal(c.principal), { action: "mailchimp.audience_chosen", summary: "Mailchimp audience chosen", object: { table: "integrations", id: conn.id } });
    revalidatePath("/settings/email");
    return okResult(t("mailchimp.audienceSaved"));
  });
}

/** Creates the Mailchimp webhook secret and returns the full URL once (the secret is part of it). */
export async function createMailchimpHook(connectionId: string): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    const id = z.string().uuid().parse(connectionId);
    const c = await manageCtx(), { t } = await getEmT();
    if (c.demo || !c.db) return failResult("invalid", t("mailchimp.demoNote"));
    const rt = await runtimeFor(c);
    const conn = await ownConnection(rt, c, id, ["mailchimp"]);
    if (!conn) return failResult("not_found", t("loadErrorBody"));
    const base = (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
    if (!base) return failResult("error", t("loadErrorBody"));
    const key = randomBytes(24).toString("base64url");
    await addToBundle(rt, conn, "webhook_secret", key);
    await markSetting(c, conn, { webhook_configured: true });
    await audit(actorFromPrincipal(c.principal), { action: "mailchimp.webhook_created", summary: "Mailchimp webhook key created", object: { table: "integrations", id: conn.id } });
    revalidatePath("/settings/email");
    return okResult(t("mailchimp.hookCreated"), { sub: t("mailchimp.hookOnce"), data: { url: `${base}/api/hooks/mailchimp/${conn.id}?k=${key}` } });
  });
}

export async function pushSegment(connectionId: string, segmentId: string): Promise<ActionResult> {
  return runAction(async () => {
    const v = z.object({ id: z.string().uuid(), segment: z.string().uuid() }).parse({ id: connectionId, segment: segmentId });
    const c = await manageCtx(), { t } = await getEmT();
    if (c.demo || !c.db) return failResult("invalid", t("mailchimp.demoNote"));
    const conn = await ownConnection(await runtimeFor(c), c, v.id, ["mailchimp"]);
    if (!conn) return failResult("not_found", t("loadErrorBody"));
    const seg = await from(c.db, "audience_segments").select("id, name, rules").eq("id", v.segment).eq("workspace_id", c.ws).maybeSingle();
    throwIfError(seg.error);
    const row = seg.data as { id: string; name: string; rules: unknown } | null;
    if (!row) return failResult("not_found", t("loadErrorBody"));
    const compiled = compileRules(parseStoredRules(row.rules));
    if (!compiled.ok) return failResult("invalid", t("loadErrorBody"));
    const { ids } = await segmentLeadIds(c.db, c.ws, compiled.filters, 5000);   // RLS-scoped: only leads this user may see
    if (!ids.length) return failResult("invalid", t("mailchimp.pushNone"));
    await enqueueSegmentPush({ connectionId: conn.id, tenantId: conn.tenantId, leadIds: ids, tag: row.name });
    await audit(actorFromPrincipal(c.principal), { action: "mailchimp.segment_push", summary: "Segment push to Mailchimp queued", object: { table: "integrations", id: conn.id }, detail: { segment: row.id, contacts: ids.length } });
    return okResult(t("mailchimp.pushQueued"), { sub: t("mailchimp.pushQueuedSub", { count: ids.length }) });
  });
}
