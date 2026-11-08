// Sandbox / showcase gateway: deterministic, in memory, no network. Used in demo mode and whenever the stored access token is the
// documented mock token (never in production, see config.ts). It models the vendor rules that matter for the UI and tests:
// the sandbox test number can message at most SANDBOX_MAX_RECIPIENTS distinct recipients (error 131030 beyond that).
import { SANDBOX_MAX_RECIPIENTS } from "./constants";
import { WhatsAppApiError, classifyError, type MediaBytes, type MediaInfo, type PhoneInfo, type ProviderTemplate, type SendResult, type WhatsAppGateway } from "./gateway";

export const WA_MOCK_TOKEN = "wa-mock-token";

export interface MockSent { to: string; kind: "text" | "template"; body?: string; template?: string; language?: string; params?: string[]; wamid: string }
export interface MockGateway extends WhatsAppGateway {
  readonly sent: MockSent[];
  /** Test hook: the next send throws this vendor error code. */
  failNext(code: number): void;
}

/** Synthetic sample templates (generic names and wording, English and Tamil). */
export const MOCK_TEMPLATES: ProviderTemplate[] = [
  { id: "mock-tpl-1", name: "sample_followup", language: "en", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Hello {{1}}, thanks for getting in touch. Reply here and we will help." }] },
  { id: "mock-tpl-2", name: "sample_followup", language: "ta", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "வணக்கம் {{1}}, தொடர்பு கொண்டதற்கு நன்றி. இங்கே பதில் அளிக்கவும்." }] },
  { id: "mock-tpl-3", name: "sample_offer", language: "en", status: "PENDING", category: "MARKETING", components: [{ type: "BODY", text: "Hello {{1}}, we have an update for you." }] },
];

export function makeMockGateway(): MockGateway {
  const sent: MockSent[] = [];
  const recipients = new Set<string>();
  let n = 0, failure: number | null = null;
  const nextId = () => `wamid.MOCK${String(++n).padStart(6, "0")}`;
  function guard(to: string): void {
    if (failure !== null) { const code = failure; failure = null; const c = classifyError(code, 400); throw new WhatsAppApiError(code, `WhatsApp API error ${code}`, 400, c.failure, c.transient); }
    if (!recipients.has(to) && recipients.size >= SANDBOX_MAX_RECIPIENTS) throw new WhatsAppApiError(131030, "WhatsApp API error 131030", 400, "recipient_not_allowed", false);
    recipients.add(to);
  }
  return {
    kind: "mock", sent,
    failNext(code) { failure = code; },
    async sendText(i): Promise<SendResult> { guard(i.to); const wamid = nextId(); sent.push({ to: i.to, kind: "text", body: i.body, wamid }); return { wamid }; },
    async sendTemplate(i): Promise<SendResult> { guard(i.to); const wamid = nextId(); sent.push({ to: i.to, kind: "template", template: i.name, language: i.language, params: i.bodyParams, wamid }); return { wamid }; },
    async listTemplates() { return MOCK_TEMPLATES.map((t) => ({ ...t })); },
    async getPhoneNumber(): Promise<PhoneInfo> { return { displayNumber: "sandbox", verifiedName: "Sandbox number", quality: "green", messagingLimitTier: "TIER_SANDBOX" }; },
    async getMediaInfo(id): Promise<MediaInfo> { return { url: `mock://media/${encodeURIComponent(id)}`, mime: "image/png", size: 8 }; },
    async downloadMedia(): Promise<MediaBytes> { return { bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), mime: "image/png" }; },
  };
}
