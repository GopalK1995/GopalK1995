// Outbound seam. Only the `mock` channel exists in this task: it never delivers, so a stored message stays `queued`.
// The WhatsApp and email connectors (T035/T038) implement the same interface and return live: true for their channel.
export interface MessageChannel {
  id: string;
  /** true when this channel can actually deliver (a connector is connected for it) */
  live: boolean;
}
export const mockChannel: MessageChannel = { id: "mock", live: false };

/** Integration ids per inbox channel, matching the integrations screens. */
export const CHANNEL_INTEGRATION: Record<string, string> = { whatsapp: "whatsapp", email: "gmail", linkedin: "linkedin" };

/** Channel resolver. No vendor connector is wired here, so every channel resolves to the mock one. */
export const channelFor = (_channel: string): MessageChannel => mockChannel;
