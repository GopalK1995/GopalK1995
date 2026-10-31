// Supabase wiring for the inbound receiver and its queue consumer. Service role only (inbound webhooks are one of the three
// sanctioned users of serviceDb, CONTRACTS C6); the Vault is read through the service-role wrappers and never logged.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Db } from "@/lib/db/client";
import { serviceDb } from "@/lib/db/service";
import { from } from "@/lib/db/query";
import { env } from "@/lib/env";
import { enqueue } from "@/lib/jobs/registry";
import { rateLimit } from "@/lib/security/rate-limit";
import { runtimeFromDb, consoleLogger } from "../core/runtime";
import { supabaseVault } from "../core/vault";
import { getConnector, isUsableIn } from "../registry";
import type { Logger } from "../core/types";
import type { InboundConnection, InboxStore, ReceiveDeps } from "./receive";
import type { InboxRow, ProcessStore } from "./process";

type R = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function supabaseInboxStore(db: Db): InboxStore & ProcessStore {
  const q = (t: string) => from(db, t);
  return {
    async getConnection(id): Promise<InboundConnection | null> {
      const { data, error } = await q("integrations").select("id,tenant_id,workspace_id,connector_id,status,webhook_secret_id,credential_secret_id,disabled_at").eq("id", id).limit(1);
      const r = ((data as R[] | null) ?? [])[0];
      if (error || !r || r.disabled_at) return null;
      return { id: String(r.id), tenantId: String(r.tenant_id), workspaceId: String(r.workspace_id), connectorId: String(r.connector_id ?? ""), status: String(r.status), webhookSecretId: str(r.webhook_secret_id), credentialSecretId: str(r.credential_secret_id) };
    },
    async insertInbox(n) {
      const { data, error } = await (db as unknown as { from(t: string): { upsert(v: R, o: R): { select(c: string): PromiseLike<{ data: R[] | null; error: unknown }> } } })
        .from("webhook_inbox")
        .upsert({ connector_id: n.connectorId, integration_id: n.connectionId, tenant_id: n.tenantId, workspace_id: n.workspaceId, provider_event_id: n.providerEventId, signature_ok: n.signatureOk, headers: n.headers, body: n.body, status: n.signatureOk ? "queued" : "ignored" }, { onConflict: "connector_id,provider_event_id", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error("inbox insert failed");
      const id = data?.[0]?.id;
      return typeof id === "number" ? { id, duplicate: false } : { id: null, duplicate: true };
    },
    async deleteInbox(id) { await (db as unknown as { from(t: string): { delete(): { eq(c: string, v: unknown): PromiseLike<unknown> } } }).from("webhook_inbox").delete().eq("id", id); },
    async getInbox(id): Promise<InboxRow | null> {
      const { data } = await q("webhook_inbox").select("id,connector_id,integration_id,signature_ok,status,headers,body").eq("id", id).limit(1);
      const r = ((data as R[] | null) ?? [])[0];
      if (!r) return null;
      return { id: Number(r.id), connectorId: String(r.connector_id), integrationId: str(r.integration_id), signatureOk: r.signature_ok === true, status: r.status as InboxRow["status"], headers: (r.headers as Record<string, string>) ?? {}, body: str(r.body) };
    },
    async mark(id, status, error) {
      await q("webhook_inbox").update({ status, error, processed_at: status === "queued" ? null : new Date().toISOString() }).eq("id", id);
    },
  };
}

export function receiveDeps(log: Logger = consoleLogger("webhook-in")): ReceiveDeps {
  const enabled = !env.demoMode && env.supabaseConfigured && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const db = enabled ? serviceDb() : (null as unknown as Db);
  const vault = enabled ? supabaseVault(db) : null;
  return {
    enabled,
    store: supabaseInboxStore(db),
    getSecret: async (id) => (vault ? vault.getSecret(id) : null),
    rate: (scope, id, cfg) => rateLimit(scope, id, cfg),
    enqueue: async (connectorId, inboxId, tenantId) => { await enqueue("connector_inbound", connectorId, { inbox_id: inboxId }, { tenantId }); },
    log, now: () => Date.now(),
    usable: (id) => { const def = getConnector(id); return !def || isUsableIn(def, env.appEnv); },
    metaVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || undefined,
  };
}

export function processDeps(db: SupabaseClient, log: Logger) {
  return { d: runtimeFromDb(db as unknown as Db, log), inbox: supabaseInboxStore(db as unknown as Db) };
}
