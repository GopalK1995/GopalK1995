// ConnectorDef for Razorpay as a TENANT payments connector (registered in src/lib/connectors/all.ts). The tenant pastes their own
// key id, key secret and webhook secret (an optional `account_id` connection setting adds an account check); the framework verifies them with one cheap call
// (`test`) and stores the bundle encrypted in the Vault. Webhooks: the receiver verifies X-Razorpay-Signature (HMAC-SHA256 of the
// raw body) with the stored webhook_secret, dedupes by X-Razorpay-Event-Id, and the queue consumer calls webhook.handle.
// Payment links are created by createPaymentRequest (links.ts) from a server action. Streams: none (events drive everything).
import type { ConnectionRow, ConnectionSecrets, ConnectorDef } from "../core/types";
import { CRED, DEFAULT_API_BASE, KEY_ID_PATTERN, RZP_CONNECTOR_ID, RZP_ENV } from "./constants";
import { apiBaseOf, gatewayFor } from "./config";
import { handleEvent } from "./events";
import type { RazorpayGateway } from "./gateway";
import { parseWebhook } from "./payload";
import type { RzpDeps } from "./store";

type Env = Record<string, string | undefined>;
export interface RzpRuntime { deps: RzpDeps; env: Env; fetchImpl?: typeof fetch }

let factory: (() => Promise<RzpRuntime>) | null = null;
/** Tests inject a runtime built on fakes; production lazily builds the service-role runtime (runtime.ts, server-only). */
export function setRzpRuntimeFactory(f: (() => Promise<RzpRuntime>) | null): void { factory = f; }
export async function razorpayRuntime(): Promise<RzpRuntime> {
  if (factory) return factory();
  return (await import("./runtime")).razorpayServiceRuntime();
}
export const gatewayOf = (rt: RzpRuntime, conn: ConnectionRow, secrets: ConnectionSecrets): RazorpayGateway => gatewayFor({ connectionId: conn.id, secrets, env: rt.env, fetchImpl: rt.fetchImpl });

export const razorpayConnector: ConnectorDef = {
  id: RZP_CONNECTOR_ID, name: "Razorpay", category: "payments", auth: "api_key",
  credentialFields: [
    { key: CRED.keyId, label: "Key ID", secret: false, pattern: KEY_ID_PATTERN },
    { key: CRED.keySecret, label: "Key secret", secret: true },
    { key: CRED.webhookSecret, label: "Webhook secret (signs payment events)", secret: true },
  ],
  gate: "none",
  sandbox: { supported: true, howTo: "razorpay.sandbox" },
  capabilities: { inbound: true, outbound: true, webhooks: true },
  streams: [], pushes: [],
  webhook: {
    // The edge already verified X-Razorpay-Signature on the raw body (verify/razorpay.ts); this only parses it.
    async verify(req) { return parseWebhook(req.rawBody, req.headers); },
    async handle(ctx, evt) {
      const rt = await razorpayRuntime(), secrets = await ctx.secrets();
      await handleEvent({ deps: rt.deps, conn: ctx.conn, secrets, reject: (r) => ctx.reject?.(r) }, evt as Parameters<typeof handleEvent>[1]);
    },
  },
  defaultFieldMap: [],
  rate: { requestsPerMinute: 120, maxRetries: 4, baseDelayMs: 500, maxDelayMs: 20_000 },
  apiBaseEnv: RZP_ENV.apiBase, defaultApiBase: DEFAULT_API_BASE,
  async test({ conn, secrets }) {
    const env = process.env as Env;
    const g = gatewayFor({ connectionId: conn.id, secrets, env });
    await g.probe();
    return { accountId: secrets[CRED.keyId], accountLabel: g.kind === "mock" ? "Showcase" : secrets[CRED.keyId]?.startsWith("rzp_test_") ? "Test mode" : "Live" };
  },
};

export { apiBaseOf };
