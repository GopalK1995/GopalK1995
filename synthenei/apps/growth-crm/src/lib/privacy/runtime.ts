// Service-role wiring for the public privacy pages (request form, verification link). Server only.
// Env (names only): PRIVACY_VERIFY_SECRET (key for the sealed link, required), APP_BASE_URL (origin used in the link),
// EMAIL_FROM / EMAIL_REPLY_TO / RESEND_API_KEY (platform system mail, shared with notifications; unset = nothing is sent).
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { rateLimit } from "@/lib/security/rate-limit";
import { platformEmailSender } from "@/lib/connectors/email/platform";
import { EMAIL_ENV } from "@/lib/connectors/email/constants";
import type { IntakeDeps } from "./intake";
import { supabaseIntakeStore } from "./store-supabase";
import { makePrT, type PrT } from "./strings";

export const PRIVACY_ENV = { verifySecret: "PRIVACY_VERIFY_SECRET" } as const;

export function intakeDeps(t: PrT = makePrT("en")): IntakeDeps {
  const env = process.env;
  const sender = platformEmailSender(env);
  return {
    store: supabaseIntakeStore(serviceDb(), (m) => console.warn(`[privacy] ${m}`)),
    secret: (env[PRIVACY_ENV.verifySecret] ?? "").trim(), baseUrl: (env[EMAIL_ENV.appBaseUrl] ?? "").trim(), now: () => Date.now(),
    rate: async (key, limit, windowMs) => (await rateLimit("privacy", key, { limit, windowMs })).ok,
    // With no platform sender configured the form must say "unavailable", not pretend a link was mailed.
    send: async (m) => (!(env[EMAIL_ENV.platformFrom] ?? "").trim() || !(env.RESEND_API_KEY ?? "").trim() ? "failed" : (await sender.send(m)).status),
    mailText: ({ org, kind, link, hours }) => ({
      subject: t("mail.subject", { org, kind: t(`kind.${kind}`) }),
      text: t("mail.body", { org, kind: t(`kind.${kind}`).toLowerCase(), link, hours }),
    }),
  };
}
