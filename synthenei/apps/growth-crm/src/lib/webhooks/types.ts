import type { WebhookDeliverPayload } from "@/lib/jobs/payloads";

/** The queue payload T019 writes, plus the fields this task adds when it re-enqueues or replays. */
export interface DeliverPayload extends Partial<WebhookDeliverPayload> {
  endpoint_id: string;
  workspace_id: string;
  /** 1-based attempt this message performs (absent = first). */
  attempt?: number;
  /** Existing webhook_deliveries row to continue (retry or replay). */
  delivery_id?: number;
  replay?: boolean;
}

export interface EndpointRow {
  id: string; tenantId: string; workspaceId: string; url: string; description: string | null; eventTypes: string[];
  secretId: string | null; previousSecretId: string | null; secretRotatedAt: string | null; active: boolean; disabledReason: string | null;
  consecutiveFailures: number; createdBy: string | null; createdAt: string;
}
export type DeliveryStatus = "pending" | "succeeded" | "failed" | "dead";
export interface DeliveryRow {
  id: number; createdAt: string; endpointId: string; eventId: string | null; eventType: string; attempt: number; status: DeliveryStatus;
  responseStatus: number | null; responseMs: number | null; responseExcerpt: string | null; nextAttemptAt: string | null;
}

export const ENDPOINT_COLS = "id,tenant_id,workspace_id,url,description,event_types,secret_id,previous_secret_id,secret_rotated_at,active,disabled_reason,consecutive_failures,created_by,created_at";
export const DELIVERY_COLS = "id,created_at,endpoint_id,event_id,event_type,attempt,status,response_status,response_ms,response_excerpt,next_attempt_at";

type R = Record<string, unknown>;
export const toEndpoint = (r: R): EndpointRow => ({
  id: String(r.id), tenantId: String(r.tenant_id), workspaceId: String(r.workspace_id), url: String(r.url), description: (r.description as string | null) ?? null,
  eventTypes: (r.event_types as string[] | null) ?? [], secretId: (r.secret_id as string | null) ?? null, previousSecretId: (r.previous_secret_id as string | null) ?? null,
  secretRotatedAt: (r.secret_rotated_at as string | null) ?? null, active: r.active !== false, disabledReason: (r.disabled_reason as string | null) ?? null,
  consecutiveFailures: Number(r.consecutive_failures ?? 0), createdBy: (r.created_by as string | null) ?? null, createdAt: String(r.created_at),
});
export const toDelivery = (r: R): DeliveryRow => ({
  id: Number(r.id), createdAt: String(r.created_at), endpointId: String(r.endpoint_id), eventId: r.event_id == null ? null : String(r.event_id), eventType: String(r.event_type),
  attempt: Number(r.attempt ?? 1), status: r.status as DeliveryStatus, responseStatus: r.response_status == null ? null : Number(r.response_status),
  responseMs: r.response_ms == null ? null : Number(r.response_ms), responseExcerpt: (r.response_excerpt as string | null) ?? null, nextAttemptAt: (r.next_attempt_at as string | null) ?? null,
});
