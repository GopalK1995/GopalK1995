// Event bus types (CONTRACTS C8.1).
export type ActorKind = "user" | "api_key" | "system" | "connector" | "agent" | "support";

export interface CrmEvent<D = Record<string, unknown>> {
  id: string;
  type: string;
  tenantId: string;
  workspaceId: string;
  objectType: string | null;
  objectId: string | null;
  actor: { kind: ActorKind; id: string | null };
  occurredAt: string;
  version: 1;
  /** { changed_fields?, before?, after? }: non-PII fields only. Consumers refetch PII under their own principal. */
  data: D;
}

export interface EventTypeDef {
  type: string;
  description: string;
  /** Can an outbound webhook subscribe to it. */
  webhook: boolean;
  /** Can an MVP2 agent trigger on it. */
  agent: boolean;
}

/** Row of public.events as read by the fan-out handler. */
export interface EventRow {
  id: number | string;
  tenant_id: string;
  workspace_id: string;
  type: string;
  object_type: string | null;
  object_id: string | null;
  actor_kind: ActorKind;
  actor_id: string | null;
  data: Record<string, unknown> | null;
  occurred_at: string;
}

export function rowToEvent(r: EventRow): CrmEvent {
  return {
    id: String(r.id), type: r.type, tenantId: r.tenant_id, workspaceId: r.workspace_id,
    objectType: r.object_type, objectId: r.object_id, actor: { kind: r.actor_kind, id: r.actor_id },
    occurredAt: r.occurred_at, version: 1, data: r.data ?? {},
  };
}
