// Meta data-deletion callback logic (AUD-088). Dependencies are injected so the route stays thin and the flow is testable without a
// database. Only the service role touches public.meta_deletion_requests (RLS on, no client policies; migration 0024).
import { randomBytes } from "node:crypto";
import { verifySignedRequest } from "./meta-signed-request";
import { LEGAL_PATHS } from "./content";

export type DeletionStatus = "received" | "disconnected" | "completed";
export interface DeletionRow { id: string; confirmationCode: string; metaUserId: string; status: DeletionStatus; requestedAt: string; completedAt: string | null }

export interface DeletionStore {
  /** Throws NotConfiguredError when the table does not exist yet (migration 0024 not applied). */
  openRequestFor(metaUserId: string): Promise<DeletionRow | null>;
  insert(r: { confirmationCode: string; metaUserId: string }): Promise<DeletionRow>;
  setStatus(id: string, status: DeletionStatus): Promise<void>;
  byCode(code: string): Promise<DeletionRow | null>;
  /** Live connections known to belong to this Meta user (see matchConnections). */
  connectionsFor(metaUserId: string): Promise<string[]>;
}
export interface DeletionDeps {
  secret: string | undefined;
  store: DeletionStore;
  /** Existing disconnect path (drops Vault secrets, flips the connection to disconnected). Returns true on success. */
  disconnect: (connectionId: string) => Promise<boolean>;
  baseUrl: string;
  log: { info: (m: string, f?: Record<string, unknown>) => void; error: (m: string, f?: Record<string, unknown>) => void };
  newCode?: () => string;
}

export class NotConfiguredError extends Error { constructor(what: string) { super(`not configured: ${what}`); this.name = "NotConfiguredError"; } }

export const newConfirmationCode = (): string => randomBytes(15).toString("base64url");   // 20 url-safe chars, 120 bits
export const CODE_RE = /^[A-Za-z0-9_-]{8,64}$/;

export type CallbackResult =
  | { status: 200; body: { url: string; confirmation_code: string } }
  | { status: 400; body: { error: "invalid_signed_request" } }
  | { status: 503; body: { error: "not_configured" } }
  | { status: 500; body: { error: "server_error" } };

export const statusUrl = (baseUrl: string, code: string): string => `${baseUrl.replace(/\/+$/, "")}${LEGAL_PATHS.status}?code=${encodeURIComponent(code)}`;

export async function handleDeletionCallback(signedRequest: unknown, d: DeletionDeps): Promise<CallbackResult> {
  if (!d.secret) { d.log.error("meta_data_deletion_not_configured", { missing: "META_APP_SECRET" }); return { status: 503, body: { error: "not_configured" } }; }
  const v = verifySignedRequest(signedRequest, d.secret);
  if (!v.ok) { d.log.info("meta_data_deletion_rejected", { reason: v.reason }); return { status: 400, body: { error: "invalid_signed_request" } }; }
  try {
    // Meta retries: an unfinished request for the same user keeps its code instead of creating a second one.
    const open = await d.store.openRequestFor(v.userId);
    let row = open;
    if (!row) row = await d.store.insert({ confirmationCode: (d.newCode ?? newConfirmationCode)(), metaUserId: v.userId });
    if (!open) {
      const conns = await d.store.connectionsFor(v.userId);
      let done = 0;
      for (const id of conns) { try { if (await d.disconnect(id)) done++; } catch { d.log.error("meta_data_deletion_disconnect_failed", { connection: id }); } }
      // Disconnecting drops credentials only. Stored metrics and social rows are erased by the operator on this request, so it is never "completed" here.
      if (done > 0) await d.store.setStatus(row.id, "disconnected");
      d.log.info("meta_data_deletion_recorded", { request: row.id, matchedConnections: conns.length, disconnected: done });
    }
    return { status: 200, body: { url: statusUrl(d.baseUrl, row.confirmationCode), confirmation_code: row.confirmationCode } };
  } catch (e) {
    if (e instanceof NotConfiguredError) { d.log.error("meta_data_deletion_not_configured", { missing: e.message }); return { status: 503, body: { error: "not_configured" } }; }
    d.log.error("meta_data_deletion_failed", {});
    return { status: 500, body: { error: "server_error" } };
  }
}

/** PostgREST / Postgres codes for "table does not exist" (undefined_table, schema cache miss). */
export const isMissingTable = (code: unknown): boolean => code === "42P01" || code === "PGRST205";
