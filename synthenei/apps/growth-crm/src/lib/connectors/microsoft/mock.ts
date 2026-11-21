// Showcase gateway: deterministic, in memory, never touches the network. Selected for the sandbox token or APP_ENV=demo without
// credentials, refused in production. Same shapes as Graph. Sent mail is recorded in memory only.
import { GraphApiError } from "./errors";
import type { DeltaPage, GraphGateway, SubscriptionInfo } from "./gateway";
import type { RawEvent, RawMessage } from "./mappers";

const MESSAGES: RawMessage[] = [
  { id: "mock-m1", subject: "Sample: question about the proposal", bodyPreview: "Sample preview text.", from: { emailAddress: { address: "sample.customer@example.invalid" } }, toRecipients: [{ emailAddress: { address: "owner@example.invalid" } }], receivedDateTime: "2026-11-02T09:00:00Z", conversationId: "mock-t1" },
];
const EVENTS: RawEvent[] = [
  { id: "mock-e1", subject: "Sample: discovery call", start: { dateTime: "2026-11-10T09:30:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-11-10T10:00:00.0000000", timeZone: "UTC" }, attendees: [{ emailAddress: { address: "sample.customer@example.invalid" } }] },
];

export interface MockGraph extends GraphGateway {
  readonly kind: "mock";
  readonly sent: { to: string[]; subject: string; body: string }[];
  readonly subscriptions: Map<string, SubscriptionInfo & { resource: string }>;
  seed(i: { messages?: RawMessage[]; events?: RawEvent[] }): void;
}

export function makeMockGraph(): MockGraph {
  let messages = MESSAGES, events = EVENTS, n = 0;
  const sent: MockGraph["sent"] = [], subscriptions: MockGraph["subscriptions"] = new Map();
  const once = <T>(link: string | null, items: T[]): DeltaPage<T> => (link ? { items: [], delta: "mock-delta" } : { items, delta: "mock-delta" });
  return {
    kind: "mock", sent, subscriptions,
    seed(i) { if (i.messages) messages = i.messages; if (i.events) events = i.events; },
    async profile() { return { id: "mock-user", mail: "owner@example.invalid", name: "Sample Owner" }; },
    async deltaMessages(folder, link) { return once(link, folder === "inbox" ? messages : []); },
    async deltaEvents(link) { return once(link, events); },
    async getMessage(id) { return messages.find((m) => m.id === id) ?? null; },
    async getEvent(id) { return events.find((e) => e.id === id) ?? null; },
    async sendMail(m) { sent.push(m); },
    async createSubscription(s) { const id = `mock-sub-${++n}`; const info = { id, expiresAt: s.expiresAt }; subscriptions.set(id, { ...info, resource: s.resource }); return info; },
    async renewSubscription(id, expiresAt) {
      const cur = subscriptions.get(id);
      if (!cur) throw new GraphApiError(404, "not_found", "Microsoft Graph error (HTTP 404)");
      cur.expiresAt = expiresAt; return { id, expiresAt };
    },
    async deleteSubscription(id) { subscriptions.delete(id); },
  };
}
