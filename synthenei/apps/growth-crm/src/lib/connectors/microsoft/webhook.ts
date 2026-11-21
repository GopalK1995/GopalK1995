// Handles one parsed Graph notification (the receiver already checked clientState and answered Graph within its deadline; the queue
// consumer calls this). A change notification carries only the resource id: the item is fetched with the connection's own token, so what
// is stored is what Microsoft says now, not what a request body claims. Deleted events cancel the row we hold; deleted mail is ignored.
import type { ConnectionRow } from "../core/types";
import { SUB_MINUTES } from "./constants";
import { GraphApiError } from "./errors";
import type { GraphGateway } from "./gateway";
import { normaliseEvent, type GraphEvent } from "./mappers";
import { ingestEvents, ingestMessages, scopeOf } from "./sync";
import type { MsDeps } from "./store";

export interface HookCtx { deps: MsDeps; conn: ConnectionRow; gateway: GraphGateway; reject: (reason: string) => void }

export async function handleGraphEvent(c: HookCtx, evt: GraphEvent): Promise<void> {
  if (evt.kind === "lifecycle") {
    // reauthorizationRequired: extend now. subscriptionRemoved / missed: the hourly stream recreates, polling catches up.
    if (evt.event === "reauthorizationRequired") {
      try { await c.gateway.renewSubscription(evt.subscriptionId, new Date(c.deps.now().getTime() + SUB_MINUTES * 60_000).toISOString()); }
      catch (e) { if (!(e instanceof GraphApiError)) throw e; c.deps.log.warn("outlook reauthorization failed", { status: e.httpStatus }); }
    }
    return;
  }
  if (evt.type === "event") {
    if (evt.changeType === "deleted") { await c.deps.store.cancelCalendarEvent(scopeOf(c.conn), evt.id); return; }
    const raw = await c.gateway.getEvent(evt.id);
    if (!raw) { await c.deps.store.cancelCalendarEvent(scopeOf(c.conn), evt.id); return; }
    const r = normaliseEvent(raw);
    if (r.kind === "reject") { c.reject(r.reason); return; }
    await ingestEvents(c, [raw]);
    return;
  }
  if (evt.changeType === "deleted") return;
  const raw = await c.gateway.getMessage(evt.id);
  if (!raw) return;
  const me = (await c.gateway.profile()).mail?.toLowerCase() ?? null;
  const from = raw.from?.emailAddress?.address?.trim().toLowerCase() ?? null;
  await ingestMessages(c, me && from === me ? "outbound" : "inbound", [raw]);
}
