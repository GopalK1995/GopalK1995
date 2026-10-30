// Typed app-level emit for non-row events (CONTRACTS C8.1). Row events come from DB triggers.
import { dbForRequest, type Db } from "@/lib/db/client";
import { mapPgError } from "@/lib/db/errors";
import { isKnownEventType, type EmittableEventType } from "./catalog";

export interface EmitInput {
  type: EmittableEventType;
  objectType?: string | null;
  objectId?: string | null;
  /** Required unless the object row resolves a workspace (service callers always pass it). */
  workspaceId?: string;
  /** Non-PII fields only. */
  data?: Record<string, unknown>;
}

type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };

/** Returns the new events.id. Uses the caller's client (user JWT) unless `db` is given (jobs pass the service client). */
export async function emitEvent(input: EmitInput, db?: Db): Promise<string> {
  if (!isKnownEventType(input.type)) throw new Error(`emitEvent: unknown event type "${input.type}" (add it to src/lib/events/catalog)`);
  const client = (db ?? (await dbForRequest())) as unknown as Rpc;
  const data = { ...(input.data ?? {}), ...(input.workspaceId ? { workspace_id: input.workspaceId } : {}) };
  const { data: id, error } = await client.rpc("emit_event", {
    p_type: input.type, p_object_type: input.objectType ?? null, p_object_id: input.objectId ?? null, p_data: data,
  });
  const err = mapPgError(error);
  if (err) throw err;
  return String(id);
}
