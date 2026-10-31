// Validation for preference and rule writes (shared by the server actions, the editors and the tests).
import { z } from "zod";
import { ct } from "./strings";
import { parseHHMM } from "./quiet";

/** Channels a tenant can use today. WhatsApp and push are in the DB enum but not connected; they are rejected, not hidden. */
export const LIVE_CHANNELS = ["in_app", "email"] as const;
const uuid = z.string().uuid();

export const EVENT_PATTERN = /^(\*|[a-z][a-z_]{0,30}\.(\*|[a-z][a-z_]{0,40}))$/;
export const RECIPIENT = /^(owner|team_manager|followers|role:[0-9a-f-]{36}|user:[0-9a-f-]{36})$/i;

export const prefSchema = z.object({
  kind: z.string().regex(EVENT_PATTERN, ct("ruleEventInvalid")),
  channels: z.array(z.enum(LIVE_CHANNELS)).max(2),
  digest: z.enum(["instant", "hourly", "daily", "off"]),
});

export const quietSchema = z.object({ from: z.string(), to: z.string() }).refine(
  (v) => { const a = parseHHMM(v.from), b = parseHHMM(v.to); return a !== null && b !== null && a !== b; },
  { message: ct("quietInvalid") },
);

export const ruleSchema = z.object({
  id: uuid.optional(),
  eventType: z.string().regex(EVENT_PATTERN, ct("ruleEventInvalid")),
  recipients: z.array(z.string().regex(RECIPIENT)).min(1, ct("ruleRecipientsInvalid")).max(10),
  channels: z.array(z.enum(LIVE_CHANNELS)).max(2).transform((c) => [...new Set<(typeof LIVE_CHANNELS)[number]>(["in_app", ...c])]),
  enabled: z.boolean(),
  template: z.object({
    title: z.record(z.string().max(80), z.string().max(140)).optional(),
    body: z.record(z.string().max(80), z.string().max(140)).optional(),
  }).default({}),
});
export type RuleInput = z.infer<typeof ruleSchema>;
