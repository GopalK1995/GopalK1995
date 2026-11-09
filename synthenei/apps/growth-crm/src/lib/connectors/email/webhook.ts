// Resend webhooks (Svix signed; the receiver already verified svix-signature on the raw body, see verify/svix.ts). This module parses
// the stored body and applies it: delivery status on the message, hard bounce and complaint to the suppression list (a complaint also
// withdraws marketing consent). Soft bounces and delays never suppress. Idempotent: a replayed delivery changes nothing the second time.
import { isHardBounce, normaliseEmail, suppressionFor, type ProviderEvent } from "./suppression";
import type { EmailStore, Scope } from "./store";
import { suppressAddress } from "./withdraw";

export interface ParsedEvent { event: ProviderEvent; providerId: string | null; to: string | null; at: string | null; bounceType?: string }
export class WebhookParseError extends Error { constructor() { super("unreadable webhook body"); this.name = "WebhookParseError"; } }

const KIND: Record<string, ProviderEvent["kind"] | undefined> = {
  "email.sent": "sent", "email.delivered": "delivered", "email.delivery_delayed": "delayed", "email.opened": "opened", "email.clicked": "clicked",
  "email.complained": "complained", "email.failed": "failed", "email.suppressed": "failed",
};

/** Parses one Resend event. Unknown types come back as null (ignored, not an error). A body that is not JSON throws. */
export function parseResendEvent(raw: string): ParsedEvent | null {
  let j: unknown;
  try { j = JSON.parse(raw); } catch { throw new WebhookParseError(); }
  if (!j || typeof j !== "object") throw new WebhookParseError();
  const o = j as { type?: unknown; created_at?: unknown; data?: Record<string, unknown> };
  const type = typeof o.type === "string" ? o.type : "";
  const d = o.data && typeof o.data === "object" ? o.data : {};
  const to = Array.isArray(d.to) && typeof d.to[0] === "string" ? d.to[0] : typeof d.to === "string" ? d.to : null;
  const base = { providerId: typeof d.email_id === "string" ? d.email_id : null, to, at: typeof o.created_at === "string" ? o.created_at : null };
  if (type === "email.bounced") {
    const b = (d.bounce ?? {}) as { type?: unknown };
    return { ...base, event: { kind: "bounced", hard: isHardBounce(b.type) }, bounceType: typeof b.type === "string" ? b.type : undefined };
  }
  const kind = KIND[type];
  if (!kind) return null;
  return { ...base, event: kind === "failed" ? { kind: "failed" } : ({ kind } as ProviderEvent) };
}

export interface WebhookCtx { store: EmailStore; scope: Scope; now: () => Date; reject: (reason: string) => void }

export async function handleEmailEvent(c: WebhookCtx, p: ParsedEvent): Promise<void> {
  const at = p.at && !Number.isNaN(Date.parse(p.at)) ? new Date(p.at).toISOString() : c.now().toISOString();
  const known = p.providerId ? await c.store.messageRecipient(c.scope.tenantId, p.providerId) : null;
  const address = p.to ?? known?.email ?? null;
  const e = p.event;

  if (p.providerId && (e.kind === "delivered" || e.kind === "sent" || e.kind === "failed" || (e.kind === "bounced" && e.hard))) {
    const status = e.kind === "delivered" ? "delivered" : e.kind === "sent" ? "sent" : "failed";
    const r = await c.store.applyStatus(c.scope.tenantId, p.providerId, status, at, status === "failed" ? { code: e.kind === "bounced" ? "hard_bounce" : "provider_failed" } : undefined);
    if (r.result === "unknown") c.reject("unknown_message");
    else if (r.messageId && r.result === "updated") await c.store.emit({ type: "message.status", workspaceId: c.scope.workspaceId, objectType: "message", objectId: r.messageId, data: { channel: "email", status } });
  }
  const reason = suppressionFor(e);
  if (reason) {
    if (!address) { c.reject("no_address"); return; }
    await suppressAddress(c.store, { tenantId: c.scope.tenantId, workspaceId: c.scope.workspaceId, email: normaliseEmail(address), reason, source: "resend_webhook", leadIds: known?.leadId ? [known.leadId] : undefined });
  }
}
