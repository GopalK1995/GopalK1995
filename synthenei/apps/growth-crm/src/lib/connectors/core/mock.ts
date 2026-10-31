// Built-in MOCK connector: deterministic fixtures, no network. Used by unit/Cypress tests and to demonstrate the framework
// on staging. It is never registered as usable in production (see registry.ts listUsable). Fixtures are synthetic.
import { CredentialError, type ConnectorDef, type SyncContext, type SyncResult } from "./types";

export const MOCK_VALID_KEY = "mock-key-ok";
export const MOCK_EXPIRED_KEY = "mock-key-expired";
export const MOCK_PAGE_SIZE = 3;
export const MOCK_TOTAL = 8;

export interface MockContact { id: string; name: string; phone: string; email: string; city: string; created: string }
/** Pure deterministic fixture n (1-based). */
export function mockContact(n: number): MockContact {
  return { id: `mock-c-${n}`, name: `Mock Contact ${n}`, phone: `98450${String(10000 + n).slice(-5)}`, email: `Mock${n}@Example.test`, city: n % 2 ? "Bengaluru" : "Madurai", created: `2026-01-${String(n).padStart(2, "0")}T05:00:00Z` };
}

async function contactsStream(ctx: SyncContext, cursor: unknown): Promise<SyncResult> {
  const secrets = await ctx.secrets();
  if (secrets.api_key === MOCK_EXPIRED_KEY || !secrets.api_key) throw new CredentialError("The mock vendor rejected the credentials");
  const from = typeof cursor === "number" ? cursor : 0;
  const to = Math.min(MOCK_TOTAL, from + MOCK_PAGE_SIZE);
  let rowsIn = 0, rowsRejected = 0;
  const sample: MockContact[] = [];
  for (let n = from + 1; n <= to; n++) {
    const c = mockContact(n);
    if (n === 7) { rowsRejected++; ctx.reject?.("invalid_phone"); continue; }   // one fixed bad row so partial runs are demonstrable
    await ctx.upsert.record("lead", "Contact", c.id, c as unknown as Record<string, unknown>);
    rowsIn++;
    sample.push(c);
  }
  return { cursor: to, rowsIn, rowsRejected, done: to >= MOCK_TOTAL, sample };
}

export const mockConnector: ConnectorDef = {
  id: "mock", name: "Mock connector", category: "data", auth: "api_key",
  credentialFields: [{ key: "api_key", label: "Test API key", secret: true }],
  gate: "none", sandbox: { supported: true, howTo: "mock.sandbox" },
  capabilities: { inbound: true, outbound: true, webhooks: false },
  streams: [{ key: "contacts", schedule: { cron: "*/15 * * * *", tz: "Asia/Kolkata" }, run: contactsStream }],
  pushes: [{
    key: "send_message", onEvent: ["lead.created"], consentPurpose: "whatsapp",
    async run(ctx) { return { ok: true, externalId: `mock-msg-${ctx.contactId.slice(0, 8)}` }; },
  }],
  defaultFieldMap: [
    { externalObject: "Contact", externalField: "name", localTable: "leads", localColumn: "full_name", direction: "in", transform: "trim", sample: "Mock Contact 1" },
    { externalObject: "Contact", externalField: "phone", localTable: "leads", localColumn: "phone", direction: "in", transform: "e164_phone", sample: "+91 98450 10001" },
    { externalObject: "Contact", externalField: "email", localTable: "leads", localColumn: "email", direction: "in", transform: "lower_email", sample: "mock1@example.test" },
    { externalObject: "Contact", externalField: "city", localTable: "leads", localColumn: "city", direction: "in", transform: null, sample: "Bengaluru" },
  ],
  rate: { requestsPerMinute: 600, maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100 },
  async test({ secrets }) {
    if (secrets.api_key !== MOCK_VALID_KEY) throw new CredentialError("The mock vendor rejected the credentials");
    return { accountId: "mock-account", accountLabel: "Mock account" };
  },
};
