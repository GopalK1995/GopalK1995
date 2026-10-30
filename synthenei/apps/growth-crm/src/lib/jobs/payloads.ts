// Typed payloads for every job kind that ships with the bus. Later tasks add their own kinds next to their handlers.
export interface EventFanoutPayload { event_id: number | string; occurred_at: string; type: string; tenant_id: string; workspace_id: string }

/** Written by the fan-out; consumed by T024 (webhook delivery). `dedupe` is stable across redeliveries of the same event. */
export interface WebhookDeliverPayload { event_id: string; occurred_at: string; endpoint_id: string; workspace_id: string; type: string; dedupe: string }
/** Consumed by the notifications task. */
export interface NotifyEventPayload { event_id: string; occurred_at: string; rule_id: string; workspace_id: string; type: string; dedupe: string }
/** Consumed by the agent runtime in MVP2 (AI gateway, T050+). */
export interface AgentTriggerPayload { event_id: string; occurred_at: string; trigger_id: string; workspace_id: string; type: string; dedupe: string }
export interface SchedulerTickPayload { limit?: number }

export const KIND = {
  eventFanout: "event.fanout",
  webhookDeliver: "webhook.deliver",
  notifyEvent: "notify.event",
  agentTrigger: "agent.trigger",
  schedulerTick: "scheduler.tick",
} as const;
