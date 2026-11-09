// Segment -> Mailchimp audience. The caller resolves a segment's lead ids (RLS-scoped, request client) and queues chunks here; each chunk
// runs the framework push (core/sync runPush), which keeps only leads that pass public.can_contact(marketing_email) and reports the rest
// as no_consent. The segment name travels as the member tag so the audience can be segmented the same way in Mailchimp.
import { enqueue, registerHandler, type JobHandler } from "@/lib/jobs/registry";
import { serviceRuntime } from "../core/runtime";
import { runPush } from "../core/sync";
import { chunkIds } from "./mapping";

export const MC_JOB = "mailchimp.push_segment" as const;
export interface PushSegmentPayload { connection_id: string; lead_ids: string[]; tag: string | null }


export const pushSegmentHandler: JobHandler<PushSegmentPayload> = async (p) => {
  const out = await runPush(serviceRuntime(), { connectionId: p.connection_id, pushKey: "contacts", leadIds: p.lead_ids, payload: { tag: p.tag } });
  return out.retry ? "retry" : "done";
};
registerHandler<PushSegmentPayload>("connector_sync", MC_JOB, pushSegmentHandler);

/** Queues the chunks (spread 2 s apart to stay well inside Mailchimp's connection limit). Returns the number of chunks. */
export async function enqueueSegmentPush(a: { connectionId: string; tenantId: string; leadIds: string[]; tag: string | null }, enqueueFn: typeof enqueue = enqueue): Promise<number> {
  const parts = chunkIds(a.leadIds);
  for (let i = 0; i < parts.length; i++) await enqueueFn("connector_sync", MC_JOB, { connection_id: a.connectionId, lead_ids: parts[i], tag: a.tag } satisfies PushSegmentPayload, { delaySeconds: i * 2, tenantId: a.tenantId });
  return parts.length;
}
