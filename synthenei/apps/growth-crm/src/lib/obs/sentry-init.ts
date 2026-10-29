import { sentryBeforeSend } from "./scrub";

/** Shared Sentry options: disabled without a DSN, replay off, PII scrubbed. */
export function sentryOptions(dsn: string | undefined) {
  return {
    dsn,
    enabled: Boolean(dsn),
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: sentryBeforeSend,
  };
}

export type TenantTags = { tenant_id?: string; workspace_id?: string; request_id?: string };

/** Attach tenant tags to the current Sentry scope (call from server code once the principal is known). No-op without a DSN. */
export async function tagScope(tags: TenantTags): Promise<void> {
  if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  for (const [k, v] of Object.entries(tags)) if (v) Sentry.setTag(k, v);
}
