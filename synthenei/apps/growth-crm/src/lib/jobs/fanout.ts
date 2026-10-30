// Event fan-out routing (BUILD-PLAN 1.10). Pure routing plus an extension point for connector pushes (T022).
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAgentEligible, isWebhookEligible } from "@/lib/events/catalog";
import type { CrmEvent } from "@/lib/events/types";
import type { MessageBody } from "./ports";
import type { QueueName } from "./queues";
import { KIND, type AgentTriggerPayload, type NotifyEventPayload, type WebhookDeliverPayload } from "./payloads";

export interface Outbound { queue: QueueName; body: MessageBody }

/** "*" matches everything, "lead.*" a prefix, otherwise exact. */
export function eventMatches(pattern: string, type: string): boolean {
  if (pattern === "*" || pattern === type) return true;
  return pattern.endsWith(".*") && type.startsWith(pattern.slice(0, -1));
}

export type FanoutExtension = (ev: CrmEvent, db: SupabaseClient) => Promise<Outbound[]>;
const extensions: FanoutExtension[] = [];
/** T022 registers the connector push routing (ConnectorDef.pushes[].onEvent) here. */
export function registerFanout(fn: FanoutExtension): void { extensions.push(fn); }
export function clearFanout(): void { extensions.length = 0; }

const UNDEFINED_TABLE = "42P01";

/** Every message the event should produce. Deterministic: the same event always yields the same dedupe keys. */
export async function routeEvent(ev: CrmEvent, db: SupabaseClient): Promise<Outbound[]> {
  const out: Outbound[] = [];
  const common = { event_id: ev.id, occurred_at: ev.occurredAt, workspace_id: ev.workspaceId, type: ev.type };

  if (isWebhookEligible(ev.type)) {
    const { data, error } = await db.from("webhook_endpoints").select("id, event_types")
      .eq("workspace_id", ev.workspaceId).eq("active", true);
    if (error) throw new Error(`webhook_endpoints: ${error.message}`);
    for (const e of (data ?? []) as { id: string; event_types: string[] | null }[]) {
      if (!(e.event_types ?? []).some((p) => eventMatches(p, ev.type))) continue;
      const payload: WebhookDeliverPayload = { ...common, endpoint_id: e.id, dedupe: `wh:${ev.id}:${e.id}` };
      out.push({ queue: "webhook_out", body: { kind: KIND.webhookDeliver, tenant_id: ev.tenantId, payload } });
    }
  }

  const rules = await db.from("notification_rules").select("id, event_type").eq("workspace_id", ev.workspaceId).eq("enabled", true);
  if (rules.error) throw new Error(`notification_rules: ${rules.error.message}`);
  for (const r of (rules.data ?? []) as { id: string; event_type: string }[]) {
    if (!eventMatches(r.event_type, ev.type)) continue;
    const payload: NotifyEventPayload = { ...common, rule_id: r.id, dedupe: `nt:${ev.id}:${r.id}` };
    out.push({ queue: "notify", body: { kind: KIND.notifyEvent, tenant_id: ev.tenantId, payload } });
  }

  // MVP2: agent_triggers subscribe to the same events. The table arrives with the agent work; until then no rows, no messages.
  if (isAgentEligible(ev.type)) {
    const trig = await db.from("agent_triggers").select("id, event_types").eq("workspace_id", ev.workspaceId).eq("enabled", true);
    if (trig.error && trig.error.code !== UNDEFINED_TABLE && trig.error.code !== "PGRST205") throw new Error(`agent_triggers: ${trig.error.message}`);
    if (!trig.error) {
      for (const t of (trig.data ?? []) as { id: string; event_types: string[] | null }[]) {
        if (!(t.event_types ?? []).some((p) => eventMatches(p, ev.type))) continue;
        const payload: AgentTriggerPayload = { ...common, trigger_id: t.id, dedupe: `ag:${ev.id}:${t.id}` };
        out.push({ queue: "agent", body: { kind: KIND.agentTrigger, tenant_id: ev.tenantId, payload } });
      }
    }
  }

  for (const x of extensions) out.push(...(await x(ev, db)));
  return out;
}
