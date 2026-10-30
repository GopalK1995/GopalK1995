// Aggregates every per-domain catalogue. To add a domain: create catalog/<domain>.ts and list it here.
import type { EventTypeDef } from "../types";
import { EVENT_TYPES as account } from "./account";
import { EVENT_TYPES as activity } from "./activity";
import { EVENT_TYPES as campaign } from "./campaign";
import { EVENT_TYPES as collab } from "./collab";
import { EVENT_TYPES as config } from "./config";
import { EVENT_TYPES as connector } from "./connector";
import { EVENT_TYPES as contact } from "./contact";
import { EVENT_TYPES as core } from "./core";
import { EVENT_TYPES as deal } from "./deal";
import { EVENT_TYPES as inbox } from "./inbox";
import { EVENT_TYPES as lead } from "./lead";
import { EVENT_TYPES as member } from "./member";
import { EVENT_TYPES as privacy } from "./privacy";
import { EVENT_TYPES as task } from "./task";
import { EVENT_TYPES as webhook } from "./webhook";

export const ALL_EVENT_TYPES = [
  ...core, ...lead, ...deal, ...account, ...contact, ...task, ...activity, ...inbox, ...campaign,
  ...collab, ...connector, ...privacy, ...config, ...member, ...webhook,
] as const;

export type KnownEventType = (typeof ALL_EVENT_TYPES)[number]["type"];

/** Custom-object events: record.<object_key>.<created|updated|deleted>. */
export type RecordEventType = `record.${string}.${"created" | "updated" | "deleted"}`;
export type EmittableEventType = KnownEventType | RecordEventType;

const BY_TYPE: ReadonlyMap<string, EventTypeDef> = new Map<string, EventTypeDef>(ALL_EVENT_TYPES.map((d) => [d.type, d]));
const RECORD_RE = /^record\.[a-z][a-z0-9_]{0,40}\.(created|updated|deleted)$/;

export function eventTypeDef(type: string): EventTypeDef | undefined {
  return BY_TYPE.get(type);
}
export function isKnownEventType(type: string): type is EmittableEventType {
  return BY_TYPE.has(type) || RECORD_RE.test(type);
}
export function isAgentEligible(type: string): boolean {
  return BY_TYPE.get(type)?.agent ?? RECORD_RE.test(type);
}
export function isWebhookEligible(type: string): boolean {
  return BY_TYPE.get(type)?.webhook ?? RECORD_RE.test(type);
}
