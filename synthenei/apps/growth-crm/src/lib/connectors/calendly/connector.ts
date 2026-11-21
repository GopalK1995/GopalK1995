// ConnectorDef for Calendly (registered in src/lib/connectors/all.ts). The tenant pastes THEIR personal access token and a signing key;
// `test` verifies the token with one read. Webhooks: the receiver verifies Calendly-Webhook-Signature (t=..,v1=HMAC-SHA256, 3 minute window)
// with the stored signing_key and dedupes by body hash; the queue consumer calls webhook.verify (parse) then webhook.handle (booking.ts).
// Subscribing is a separate call (subscribeCalendly, api.ts) the integrator runs from a server action after connect; it needs a PAID Calendly plan.
import { CredentialError, type ConnectionRow, type ConnectorDef } from "../core/types";
import { handleBooking } from "./booking";
import type { BookingEvent } from "./booking-types";
import type { BookingDeps } from "./store";
import { calendlyBase, whoAmI } from "./api";
import { CALENDLY_CRED, CALENDLY_DEFAULT_BASE, CALENDLY_ENV, CALENDLY_ID } from "./constants";
import { parseCalendly } from "./payload";
import { vendorFetch } from "./subscribe";

export interface BookingRuntime { deps: BookingDeps }
let factory: (() => Promise<BookingRuntime>) | null = null;
/** Tests inject a runtime built on fakes; production lazily builds the service-role runtime (runtime.ts, server-only). */
export function setBookingRuntimeFactory(f: (() => Promise<BookingRuntime>) | null): void { factory = f; }
export async function bookingRuntime(): Promise<BookingRuntime> {
  if (factory) return factory();
  return (await import("./runtime")).bookingServiceRuntime();
}
/** Shared handle() for both vendors. */
export async function handleBookingEvent(conn: ConnectionRow, evt: unknown, reject?: (r: string) => void): Promise<void> {
  const rt = await bookingRuntime();
  await handleBooking({ deps: rt.deps, conn, reject }, evt as BookingEvent);
}

export const calendlyConnector: ConnectorDef = {
  id: CALENDLY_ID, name: "Calendly", category: "scheduling", auth: "api_key",
  credentialFields: [
    { key: CALENDLY_CRED.token, label: "Personal access token", secret: true },
    { key: CALENDLY_CRED.signingKey, label: "Signing key (any long random string)", secret: true, pattern: "^[A-Za-z0-9_\\-]{24,128}$" },
  ],
  gate: "none",
  sandbox: { supported: false, howTo: "calendly.sandbox" },
  capabilities: { inbound: true, outbound: false, webhooks: true },
  streams: [], pushes: [],
  webhook: {
    // The edge already verified Calendly-Webhook-Signature on the raw body (verify/calendly.ts); this only parses it.
    async verify(req) { return parseCalendly(req.rawBody); },
    async handle(ctx, evt) { await handleBookingEvent(ctx.conn, evt, (r) => ctx.reject?.(r)); },
  },
  defaultFieldMap: [],
  rate: { requestsPerMinute: 60, maxRetries: 3, baseDelayMs: 500, maxDelayMs: 15_000 },
  apiBaseEnv: CALENDLY_ENV.apiBase, defaultApiBase: CALENDLY_DEFAULT_BASE,
  async test({ secrets, apiBase }) {
    const me = await whoAmI(vendorFetch(), apiBase || calendlyBase(process.env), secrets);
    if (!me.uri) throw new CredentialError("Calendly rejected the token");
    return { accountId: me.uri.split("/").pop(), accountLabel: me.email || me.name || "Calendly" };
  },
};
