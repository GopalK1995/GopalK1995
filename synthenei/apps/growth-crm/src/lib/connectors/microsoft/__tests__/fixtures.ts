// Synthetic fixtures in Microsoft Graph's published response shapes. All names, addresses and ids are invented (.invalid / example).
import type { RawEvent, RawMessage } from "../mappers";

export const MSG = (over: Partial<RawMessage> = {}): RawMessage => ({
  id: "AAMkAD-msg-1=", subject: "Re: proposal", bodyPreview: "Thanks, we would like to go ahead.", conversationId: "AAQkAD-conv-1=",
  from: { emailAddress: { name: "Asha K", address: "Asha.K@Client.example.invalid" } },
  toRecipients: [{ emailAddress: { address: "owner@firm.example.invalid" } }], ccRecipients: [],
  receivedDateTime: "2026-11-02T09:00:00Z", sentDateTime: "2026-11-02T08:59:58Z", isDraft: false, ...over,
});

export const EVENT = (over: Partial<RawEvent> = {}): RawEvent => ({
  id: "AAMkAD-evt-1=", subject: "Discovery call", isCancelled: false, isAllDay: false, showAs: "busy",
  start: { dateTime: "2026-11-10T09:30:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-11-10T10:00:00.0000000", timeZone: "UTC" },
  attendees: [{ emailAddress: { address: "asha.k@client.example.invalid" } }], ...over,
});

export const NOTIFICATION = (over: Record<string, unknown> = {}) => ({
  subscriptionId: "7f105c8f-0000-4000-8000-000000000001", clientState: "state-secret-0123456789", changeType: "created", resource: "Users/u/Messages/AAMkAD-msg-1=",
  resourceData: { "@odata.type": "#Microsoft.Graph.Message", id: "AAMkAD-msg-1=" }, subscriptionExpirationDateTime: "2026-11-05T10:00:00Z", tenantId: "00000000-0000-4000-8000-000000000002", ...over,
});
