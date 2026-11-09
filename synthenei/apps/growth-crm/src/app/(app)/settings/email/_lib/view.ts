// Loader for /settings/email: one view model for demo and real sessions. Real reads go through the signed-in user's client (RLS);
// nothing here touches the Vault, so credentials cannot reach the page. Demo data is clearly sample data and labelled Showcase.
import { requireActive } from "@/lib/auth/server";
import { can } from "@/lib/authz/engine";
import { loadPrincipal } from "@/lib/authz/load";
import { dbForRequest } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import { domainStateOf } from "@/lib/connectors/email/domain";
import { senderOf, type Sender } from "@/lib/connectors/email/config";
import type { DomainState } from "@/lib/connectors/email/transport";
import type { SuppressionReason } from "@/lib/connectors/email/suppression";

export type Denied = { status: "denied"; reason: "support" | "role"; roleLabel: string };
export interface ConnView { id: string; connectorId: "resend" | "email-smtp"; status: string; showcase: boolean; sender: Sender; domain: DomainState | null; webhookSecretSet: boolean; lastError: string | null }
export interface McView { id: string; status: string; audienceId: string | null; hookCreated: boolean }
export interface SuppressionRow { email: string; reason: SuppressionReason; source: string; at: string }
export interface SegmentOption { id: string; name: string }
export type EmailView =
  | { status: "ok"; demo: boolean; mayPii: boolean; email: ConnView | null; mailchimp: McView | null; suppressions: SuppressionRow[]; suppressionMissing: boolean; segments: SegmentOption[]; webhookUrl: string | null }
  | Denied
  | { status: "error" };

const DEMO_SENDER: Sender = { fromEmail: "hello@example.com", fromName: "Sample Business", replyTo: "support@example.com", footer: "Sample Business, 1 Example Street, Sampletown", dkimSelector: null, domainId: null };
const DEMO: EmailView = {
  status: "ok", demo: true, mayPii: true, webhookUrl: null, suppressionMissing: false,
  email: { id: "demo", connectorId: "resend", status: "sandbox", showcase: true, sender: DEMO_SENDER, domain: { status: "showcase", domain: "example.com", records: [], checkedAt: "1970-01-01T00:00:00.000Z" }, webhookSecretSet: false, lastError: null },
  mailchimp: null,
  suppressions: [
    { email: "bounced@example.com", reason: "hard_bounce", source: "sample", at: "2026-10-01T09:00:00.000Z" },
    { email: "opted.out@example.com", reason: "unsubscribe", source: "sample", at: "2026-10-03T11:30:00.000Z" },
  ],
  segments: [],
};

/** a***@d***.com: enough to recognise your own contact, not enough to harvest. */
export function maskEmail(e: string): string {
  const [u, d] = e.split("@");
  if (!u || !d) return "***";
  const dot = d.lastIndexOf(".");
  return `${u[0]}***@${d[0]}***${dot > 0 ? d.slice(dot) : ""}`;
}

export async function loadEmailView(): Promise<EmailView> {
  const { session, active } = await requireActive();
  if (active.support) return { status: "denied", reason: "support", roleLabel: active.role };
  const p = await loadPrincipal();
  if (!can(p, "integrations.manage")) return { status: "denied", reason: "role", roleLabel: active.role };
  if (session.demo === true) return DEMO;
  try {
    const db = await dbForRequest();
    const ws = active.ws.uuid;
    const ints = await from(db, "integrations").select("id, connector_id, status, mode, settings, health, last_error").eq("workspace_id", ws).in("connector_id", ["resend", "email-smtp", "mailchimp"]);
    if (ints.error) return { status: "error" };
    type Row = { id: string; connector_id: string; status: string; mode: string; settings: Record<string, unknown> | null; health: unknown; last_error: string | null };
    const rows = ((ints.data as Row[] | null) ?? []).filter((r) => r.status !== "disconnected");
    const e = rows.find((r) => r.connector_id === "resend") ?? rows.find((r) => r.connector_id === "email-smtp");
    const m = rows.find((r) => r.connector_id === "mailchimp");
    const email: ConnView | null = e ? {
      id: e.id, connectorId: e.connector_id as ConnView["connectorId"], status: e.status, showcase: e.mode === "sandbox" || e.status === "sandbox",
      sender: senderOf(e.settings ?? {}), domain: domainStateOf(e.health), webhookSecretSet: (e.settings ?? {}).webhook_secret_set === true, lastError: e.last_error,
    } : null;
    const sup = await from(db, "email_suppressions").select("email, reason, source, created_at").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(100);
    const suppressionMissing = !!sup.error && ["PGRST205", "42P01"].includes(String(sup.error.code ?? ""));
    if (sup.error && !suppressionMissing) return { status: "error" };
    const mayPii = can(p, "pii.read");
    const suppressions = ((sup.data as { email: string; reason: string; source: string; created_at: string }[] | null) ?? []).map((r) => ({ email: mayPii ? r.email : maskEmail(r.email), reason: r.reason as SuppressionReason, source: r.source, at: r.created_at }));
    const seg = await from(db, "audience_segments").select("id, name").eq("workspace_id", ws).order("name", { ascending: true }).limit(100);
    const base = (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
    return {
      status: "ok", demo: false, mayPii, email, suppressions, suppressionMissing,
      mailchimp: m ? { id: m.id, status: m.status, audienceId: typeof m.settings?.audience_id === "string" ? m.settings.audience_id : null, hookCreated: m.settings?.webhook_configured === true } : null,
      segments: ((seg.data as SegmentOption[] | null) ?? []).map((s) => ({ id: String(s.id), name: String(s.name) })),
      webhookUrl: email?.connectorId === "resend" && base ? `${base}/api/hooks/resend/${email.id}` : null,
    };
  } catch { return { status: "error" }; }
}
