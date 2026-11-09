// Sandbox / showcase transport: in memory, no network, nothing is delivered. Used in demo mode and whenever the stored API key is the
// documented sandbox key (never in production, see config.ts). Its domain state says "showcase", never "verified".
import { EmailApiError, type DomainState, type EmailTransport, type OutboundEmail } from "./transport";

export interface MockEmailTransport extends EmailTransport { readonly sent: (OutboundEmail & { providerId: string })[]; failNext(failure: "invalid_recipient" | "rejected"): void }

export function makeMockTransport(): MockEmailTransport {
  const sent: (OutboundEmail & { providerId: string })[] = [];
  const seen = new Map<string, string>();
  let n = 0, fail: "invalid_recipient" | "rejected" | null = null;
  const showcase = (domain: string): DomainState => ({ status: "showcase", domain, records: [], checkedAt: new Date(0).toISOString() });
  return {
    kind: "mock", sent,
    async ping() { /* nothing to check: the sandbox has no network */ },
    failNext(f) { fail = f; },
    async send(m) {
      if (fail) { const f = fail; fail = null; throw new EmailApiError("Sandbox refusal", 422, f); }
      const dup = seen.get(m.idempotencyKey);
      if (dup) return { providerId: dup };   // same key = same message, like the real provider
      const providerId = `mock_${String(++n).padStart(6, "0")}`;
      seen.set(m.idempotencyKey, providerId);
      sent.push({ ...m, providerId });
      return { providerId };
    },
    domain: { async ensure(domain) { return showcase(domain); }, async refresh(_id, domain) { return showcase(domain); } },
  };
}
