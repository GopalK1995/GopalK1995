// Gated start of the Gmail connect flow (server-action target behind `integrations.manage`). The OAuth route asks THIS for the scopes:
// while the gate is closed it gets none, so a restricted scope is never requested unless the tenant explicitly opted in (both
// acknowledgements) AND the platform's Google app is in testing (or has passed CASA). The opt-in is audited against the connection row.
import type { RuntimeDeps } from "../../core/ports";
import type { Actor } from "../../core/lifecycle";
import { GMAIL_CONNECTOR_ID } from "./constants";
import { gmailGate, gmailScopes, isFullOptIn, type GmailGate, type GmailOptIn } from "./gate";

export type GmailStart = { ok: true; scopes: string[]; gate: GmailGate; connectionId: string } | { ok: false; code: "gate_closed" | "opt_in_required" | "audit_failed" | "already_connected"; gate: GmailGate };

export async function startGmailConnect(d: RuntimeDeps, actor: Actor, optIn: Partial<GmailOptIn> | null): Promise<GmailStart> {
  const full = isFullOptIn(optIn);
  const gate = gmailGate(d.env, full);
  if (!gate.open) return { ok: false, code: gate.reasons.includes("not_opted_in") && gate.reasons.length === 1 ? "opt_in_required" : "gate_closed", gate };
  let conn = await d.store.findConnection(actor.workspaceId, GMAIL_CONNECTOR_ID);
  if (conn && conn.tenantId !== actor.tenantId) return { ok: false, code: "gate_closed", gate };
  if (conn?.credentialSecretId && (conn.status === "connected" || conn.status === "sandbox")) return { ok: false, code: "already_connected", gate };
  if (!conn) conn = await d.store.insertConnection({ tenantId: actor.tenantId, workspaceId: actor.workspaceId, connectorId: GMAIL_CONNECTOR_ID, label: "Gmail", category: "email", direction: "both", mode: "sandbox", status: "not_configured", connectedBy: actor.uid });
  if (d.audit) { try { await d.audit({ action: "gmail.opt_in", summary: "Opted in to the Gmail connection (restricted scope, testing mode)", connectionId: conn.id, detail: { mode: gate.mode } }); } catch { return { ok: false, code: "audit_failed", gate }; } }
  return { ok: true, scopes: gmailScopes(d.env, true), gate, connectionId: conn.id };
}
