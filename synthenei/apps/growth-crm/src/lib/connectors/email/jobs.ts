// Campaign and batch sends through the job queue (connector_sync queue). A campaign job splits its recipients into batches and
// staggers them so the per-connection rate limit is met by scheduling, not by failing; a batch job sends through the same pipeline as
// every other email (consent, suppression, merge-field, unsubscribe and idempotency gates). A throttled or transient batch hands its
// unsent leads to a new, delayed batch instead of retrying the whole one, so recipients already mailed are not mailed twice (the
// per-lead idempotency key backs this up at Resend).
import { enqueue, registerHandler, type JobHandler } from "@/lib/jobs/registry";
import { isRunnable } from "../core/sync";
import { loadSecrets } from "../core/secrets";
import { safeError } from "../core/pii";
import { CredentialError } from "../core/types";
import { BATCH_SIZE, JOB_KIND, SEND_PER_MINUTE } from "./constants";
import { emailRuntime, transportOf } from "./connector";
import { sendTemplateBatch } from "./send";

export interface CampaignPayload { connection_id: string; template_id: string; lead_ids: string[]; campaign_key: string }
export interface BatchPayload extends CampaignPayload { part: number }

const MAX_LEADS_PER_CAMPAIGN = 20_000;
export const chunk = <T,>(a: readonly T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
/** Seconds between batches so BATCH_SIZE messages per batch stay under SEND_PER_MINUTE. */
export const BATCH_GAP_S = Math.ceil((BATCH_SIZE / SEND_PER_MINUTE) * 60);

export const campaignHandler: JobHandler<CampaignPayload> = async (p) => {
  const ids = [...new Set(p.lead_ids)].slice(0, MAX_LEADS_PER_CAMPAIGN);
  const rt = await emailRuntime();
  const conn = await rt.core.store.getConnection(p.connection_id);
  if (!conn || !isRunnable(conn)) return "done";
  await Promise.all(chunk(ids, BATCH_SIZE).map((leads, i) => enqueue("connector_sync", JOB_KIND.batch, { ...p, lead_ids: leads, part: i } satisfies BatchPayload, { delaySeconds: i * BATCH_GAP_S, tenantId: conn.tenantId })));
  await rt.deps.store.audit({ workspaceId: conn.workspaceId, action: "email.campaign_started", summary: `Email send started for ${ids.length} recipients`, objectId: conn.id, detail: { recipients: ids.length, batches: Math.ceil(ids.length / BATCH_SIZE) } }).catch(() => undefined);
  return "done";
};

export const batchHandler: JobHandler<BatchPayload> = async (p) => {
  const rt = await emailRuntime();
  const conn = await rt.core.store.getConnection(p.connection_id);
  if (!conn || !isRunnable(conn)) return "done";
  const runId = await rt.core.store.startRun({ connectionId: conn.id, tenantId: conn.tenantId, workspaceId: conn.workspaceId, kind: "outbound", stream: `email:${p.campaign_key}`.slice(0, 80), mode: conn.mode });
  try {
    const secrets = await loadSecrets(rt.core.vault, conn);
    const r = await sendTemplateBatch(rt.deps, conn, transportOf(rt, conn, secrets), { templateId: p.template_id, leadIds: p.lead_ids, campaignKey: p.campaign_key });
    const blocked = Object.values(r.blocked).reduce((a, b) => a + b, 0);
    await rt.core.store.finishRun(runId, { status: blocked || r.failed ? "partial" : "success", rowsIn: r.sent, rowsOut: r.sent, rowsRejected: blocked + r.failed, error: null, payloadSample: { sent: r.sent, failed: r.failed, blocked: r.blocked } });
    if (r.remaining.length) await enqueue("connector_sync", JOB_KIND.batch, { ...p, lead_ids: r.remaining, part: p.part } satisfies BatchPayload, { delaySeconds: 60, tenantId: conn.tenantId });
    return "done";
  } catch (e) {
    await rt.core.store.finishRun(runId, { status: "failed", rowsIn: 0, rowsOut: 0, rowsRejected: 0, error: `Email batch failed: ${safeError(e, 200)}` }).catch(() => undefined);
    if (e instanceof CredentialError) { await rt.core.store.updateConnection(conn.id, { status: "needs_attention", lastError: "The email provider rejected the saved credentials. Reconnect it to resume sending." }); return "done"; }
    return "retry";
  }
};

registerHandler<CampaignPayload>("connector_sync", JOB_KIND.campaign, campaignHandler);
registerHandler<BatchPayload>("connector_sync", JOB_KIND.batch, batchHandler);

/** Queues a template send to leads (the caller has already authorised it: `messages.send_email`). Consent is NOT decided here; every recipient is gated at send time. */
export async function enqueueEmailCampaign(p: CampaignPayload, tenantId: string): Promise<void> {
  await enqueue("connector_sync", JOB_KIND.campaign, p, { tenantId });
}
