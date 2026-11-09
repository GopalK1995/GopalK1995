import type { Metadata } from "next";
import { env } from "@/lib/env";
import { EMAIL_ENV } from "@/lib/connectors/email/constants";
import { getEmT } from "@/lib/connectors/email/strings";
import { previewUnsubscribe } from "@/lib/connectors/email/unsubscribe-apply";
import { confirmUnsubscribe } from "./actions";

// Public page behind every email's unsubscribe link. GET never writes (mail scanners prefetch links): the person confirms with a
// button, which posts to a server action. No tenant, brand or sender details are shown: the page needs none and leaks none.
export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string; e?: string }> }) {
  const { token } = await params, q = await searchParams;
  const { t } = await getEmT();
  const secret = (process.env[EMAIL_ENV.unsubscribeSecret] ?? "").trim();
  const shell = (title: string, body: string, action?: React.ReactNode) => (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-3 px-4 py-10" data-testid="unsubscribe">
      <h1 className="text-20 font-semibold text-ink">{title}</h1>
      <p className="text-14 text-ink-2" role="status">{body}</p>
      {action}
    </main>
  );
  if (env.demoMode || !secret) return shell(t("unsubscribe.unavailableTitle"), t("unsubscribe.unavailableBody"));
  const p = previewUnsubscribe(decodeURIComponent(token), secret, Date.now());
  if (p.status === "expired") return shell(t("unsubscribe.expiredTitle"), t("unsubscribe.expiredBody"));
  if (p.status === "invalid") return shell(t("unsubscribe.invalidTitle"), t("unsubscribe.invalidBody"));
  if (q.done === "1") return shell(t("unsubscribe.doneTitle"), t("unsubscribe.doneBody"));
  const confirm = confirmUnsubscribe.bind(null, decodeURIComponent(token));
  return shell(t("unsubscribe.title"), q.e === "1" ? t("unsubscribe.error") : t("unsubscribe.ready"), (
    <form action={confirm}>
      <button type="submit" className="h-9 rounded-control bg-accent px-4 text-14 font-medium text-white">{t("unsubscribe.confirm")}</button>
    </form>
  ));
}
