// ConnectorDef for Cal.com (registered in src/lib/connectors/all.ts; id "cal-com"). Same flow as Calendly with a different parser and signature:
// X-Cal-Signature-256 = HMAC-SHA256(webhook_secret, raw body) hex, verified at the edge (verify/calcom.ts). Cal.com sends no timestamp, so
// replay protection is the dedupe key (body hash) plus the forward-only calendar row.
import type { ConnectorDef } from "../core/types";
import { handleBookingEvent } from "../calendly/connector";
import { vendorFetch } from "../calendly/subscribe";
import { calcomBase, whoAmI } from "./api";
import { CALCOM_CRED, CALCOM_DEFAULT_BASE, CALCOM_ENV, CALCOM_ID } from "./constants";
import { parseCalcom } from "./payload";

export const calcomConnector: ConnectorDef = {
  id: CALCOM_ID, name: "Cal.com", category: "scheduling", auth: "api_key",
  credentialFields: [
    { key: CALCOM_CRED.apiKey, label: "API key", secret: true },
    { key: CALCOM_CRED.webhookSecret, label: "Webhook secret (any long random string)", secret: true, pattern: "^[A-Za-z0-9_\-]{24,128}$" },
  ],
  gate: "none",
  sandbox: { supported: false, howTo: "calcom.sandbox" },
  capabilities: { inbound: true, outbound: false, webhooks: true },
  streams: [], pushes: [],
  webhook: {
    async verify(req) { return parseCalcom(req.rawBody); },
    async handle(ctx, evt) { await handleBookingEvent(ctx.conn, evt, (r) => ctx.reject?.(r)); },
  },
  defaultFieldMap: [],
  rate: { requestsPerMinute: 60, maxRetries: 3, baseDelayMs: 500, maxDelayMs: 15_000 },
  apiBaseEnv: CALCOM_ENV.apiBase, defaultApiBase: CALCOM_DEFAULT_BASE,
  async test({ secrets, apiBase }) {
    const me = await whoAmI(vendorFetch(), apiBase || calcomBase(process.env), secrets);
    return { accountId: me.id, accountLabel: me.label };
  },
};
