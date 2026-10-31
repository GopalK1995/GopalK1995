// Service-role persistence for the delivery path (queue handler, test ping, replay). Every query is scoped by workspace.
// Secrets are read from Vault here and nowhere else on the delivery path; they only ever reach the signer.
import type { SupabaseClient } from "@supabase/supabase-js";
import { SYSTEM_ROLES } from "@/lib/authz/catalog/system-roles";
import type { EventRow } from "@/lib/events/types";
import { DELIVERY_COLS, ENDPOINT_COLS, toDelivery, toEndpoint, type DeliveryRow, type DeliveryStatus, type EndpointRow } from "./types";

type Rec = Record<string, unknown>;
type Err = { message: string } | null;
const must = (e: Err, what: string) => { if (e) throw new Error(`${what}: ${e.message}`); };

export interface DeliveryPatch { attempt?: number; status?: DeliveryStatus; responseStatus?: number | null; responseMs?: number | null; responseExcerpt?: string | null; nextAttemptAt?: string | null }
export interface NewDelivery { endpointId: string; eventId: string | null; eventType: string; attempt: number; status: DeliveryStatus }

export interface WebhookStore {
  endpoint(id: string, ws: string): Promise<EndpointRow | null>;
  secret(vaultId: string): Promise<string | null>;
  event(id: string, ws: string, occurredAt?: string): Promise<EventRow | null>;
  deliveryById(id: number, endpointId: string): Promise<DeliveryRow | null>;
  latestDelivery(endpointId: string, eventId: string): Promise<DeliveryRow | null>;
  insertDelivery(d: NewDelivery): Promise<DeliveryRow>;
  updateDelivery(id: number, createdAt: string, p: DeliveryPatch): Promise<void>;
  lastSuccessAt(endpointId: string): Promise<string | null>;
  setFailures(endpointId: string, n: number): Promise<void>;
  disable(endpointId: string, reason: string): Promise<void>;
  /** Active owners of the workspace, to notify. */
  ownerIds(ws: string): Promise<string[]>;
  notifyOwners(e: EndpointRow, owners: string[]): Promise<void>;
  /** True when the endpoint creator is still an active member whose system role holds pii.read. Custom roles fail closed. */
  creatorHoldsPii(e: EndpointRow): Promise<boolean>;
}

const PII_ROLES = new Set<string>(SYSTEM_ROLES.filter((r) => r.grants["pii.read"] !== undefined).map((r) => r.key));

export function supabaseWebhookStore(db: SupabaseClient): WebhookStore {
  return {
    async endpoint(id, ws) {
      const { data, error } = await db.from("webhook_endpoints").select(ENDPOINT_COLS).eq("id", id).eq("workspace_id", ws).maybeSingle();
      must(error, "webhook_endpoints");
      return data ? toEndpoint(data as Rec) : null;
    },
    async secret(vaultId) {
      const { data, error } = await db.rpc("vault_get_secret", { p_id: vaultId });
      must(error, "vault");
      return typeof data === "string" && data ? data : null;
    },
    async event(id, ws, occurredAt) {
      let q = db.from("events").select("*").eq("id", id).eq("workspace_id", ws);
      if (occurredAt) q = q.eq("occurred_at", occurredAt);
      const { data, error } = await q.order("occurred_at", { ascending: false }).limit(1).maybeSingle();
      must(error, "events");
      return (data as EventRow | null) ?? null;
    },
    async deliveryById(id, endpointId) {
      const { data, error } = await db.from("webhook_deliveries").select(DELIVERY_COLS).eq("id", id).eq("endpoint_id", endpointId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      must(error, "webhook_deliveries");
      return data ? toDelivery(data as Rec) : null;
    },
    async latestDelivery(endpointId, eventId) {
      const { data, error } = await db.from("webhook_deliveries").select(DELIVERY_COLS).eq("endpoint_id", endpointId).eq("event_id", eventId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      must(error, "webhook_deliveries");
      return data ? toDelivery(data as Rec) : null;
    },
    async insertDelivery(d) {
      const { data, error } = await db.from("webhook_deliveries").insert({ endpoint_id: d.endpointId, event_id: d.eventId, event_type: d.eventType, attempt: d.attempt, status: d.status }).select(DELIVERY_COLS).single();
      must(error, "webhook_deliveries insert");
      return toDelivery(data as Rec);
    },
    async updateDelivery(id, createdAt, p) {
      const row: Rec = {};
      if (p.attempt !== undefined) row.attempt = p.attempt;
      if (p.status !== undefined) row.status = p.status;
      if (p.responseStatus !== undefined) row.response_status = p.responseStatus;
      if (p.responseMs !== undefined) row.response_ms = p.responseMs;
      if (p.responseExcerpt !== undefined) row.response_excerpt = p.responseExcerpt;
      if (p.nextAttemptAt !== undefined) row.next_attempt_at = p.nextAttemptAt;
      const { error } = await db.from("webhook_deliveries").update(row).eq("id", id).eq("created_at", createdAt);
      must(error, "webhook_deliveries update");
    },
    async lastSuccessAt(endpointId) {
      const { data, error } = await db.from("webhook_deliveries").select("created_at").eq("endpoint_id", endpointId).eq("status", "succeeded").order("created_at", { ascending: false }).limit(1).maybeSingle();
      must(error, "webhook_deliveries");
      return (data as { created_at: string } | null)?.created_at ?? null;
    },
    async setFailures(endpointId, n) {
      const { error } = await db.from("webhook_endpoints").update({ consecutive_failures: n }).eq("id", endpointId);
      must(error, "webhook_endpoints update");
    },
    async disable(endpointId, reason) {
      const { error } = await db.from("webhook_endpoints").update({ active: false, disabled_reason: reason }).eq("id", endpointId);
      must(error, "webhook_endpoints disable");
    },
    async ownerIds(ws) {
      const { data, error } = await db.from("memberships").select("user_id").eq("workspace_id", ws).eq("role", "owner").eq("is_active", true);
      must(error, "memberships");
      return ((data as { user_id: string }[] | null) ?? []).map((r) => r.user_id);
    },
    async notifyOwners(e, owners) {
      if (owners.length === 0) return;
      const rows = owners.map((u) => ({
        tenant_id: e.tenantId, workspace_id: e.workspaceId, user_id: u, kind: "webhook.endpoint.disabled", object_type: "webhook_endpoint", object_id: e.id,
        title: { en: "A webhook endpoint was turned off", ta: "வெப்ஹூக் முனை நிறுத்தப்பட்டது" },
        body: { en: "Deliveries kept failing, so the endpoint was paused. Fix the receiver, then turn it back on.", ta: "அனுப்புதல் தொடர்ந்து தோல்வியடைந்ததால் முனை நிறுத்தப்பட்டது. பெறுநரை சரிசெய்து மீண்டும் இயக்கவும்." },
        url: "/settings/webhooks",
      }));
      const { error } = await db.from("notifications").insert(rows);
      must(error, "notifications");
    },
    async creatorHoldsPii(e) {
      if (!e.createdBy) return false;
      const { data, error } = await db.from("memberships").select("role,is_active").eq("user_id", e.createdBy).eq("workspace_id", e.workspaceId).maybeSingle();
      must(error, "memberships");
      const m = data as { role: string; is_active: boolean } | null;
      return !!m && m.is_active !== false && PII_ROLES.has(m.role);
    },
  };
}
