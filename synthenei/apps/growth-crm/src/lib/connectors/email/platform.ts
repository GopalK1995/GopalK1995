// Platform-level sender for SYSTEM mail (notification emails to the CRM's own users). The sender address and key come from env NAMES only
// (EMAIL_FROM, EMAIL_REPLY_TO, RESEND_API_KEY): nothing is defaulted in code, and with any of them unset the sender reports "queued" and
// sends nothing (the same behaviour as the stub it replaces). It never carries a tenant's marketing mail: that always goes through a
// tenant's own connection and the consent/suppression gates in send.ts. Wire it with setEmailSender(platformEmailSender(process.env)).
import type { EmailMessage, EmailResult, EmailSender } from "@/lib/notify/email";
import { CredentialError, TransientError } from "../core/types";
import { EMAIL_ENV, MOCK_API_KEY } from "./constants";
import { resendBaseOf, mockAllowed, mockFor } from "./config";
import { isEmail } from "./mime";
import { makeResendTransport } from "./resend";
import { EmailApiError } from "./transport";

type Env = Record<string, string | undefined>;

export function platformEmailSender(env: Env, fetchImpl?: typeof fetch): EmailSender {
  return {
    async send(msg: EmailMessage): Promise<EmailResult> {
      const from = (env[EMAIL_ENV.platformFrom] ?? "").trim(), key = (env.RESEND_API_KEY ?? "").trim(), reply = (env[EMAIL_ENV.platformReplyTo] ?? "").trim();
      if (!from || !key || !isEmail(from) || !isEmail(msg.to)) return { status: "queued" };
      const mock = key === MOCK_API_KEY;
      if (mock && !mockAllowed(env)) return { status: "failed", reason: "sandbox key refused in production" };
      const transport = mock ? mockFor("platform") : makeResendTransport({ apiBase: resendBaseOf(env), apiKey: key, fetch: fetchImpl });
      try {
        const r = await transport.send({ from: { email: from }, to: { email: msg.to }, replyTo: reply && isEmail(reply) ? { email: reply } : undefined, subject: msg.subject, text: msg.text, headers: {}, tags: { crm_kind: "system" }, idempotencyKey: `sys:${msg.dedupe}` });
        return { status: "sent", providerId: r.providerId };
      } catch (e) {
        if (e instanceof TransientError) return { status: "queued" };   // the notify job retries
        if (e instanceof CredentialError) return { status: "failed", reason: "email provider rejected the platform key" };
        if (e instanceof EmailApiError) return { status: "failed", reason: e.failure };
        throw e;
      }
    },
  };
}
