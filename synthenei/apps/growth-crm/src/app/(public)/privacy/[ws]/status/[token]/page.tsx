import type { Metadata } from "next";
import Link from "next/link";
import { supabaseConfigured } from "@/lib/supabase/server";
import { viewStatus } from "@/lib/privacy/dsr";
import { getPrT } from "@/lib/privacy/strings-server";
import { fmtIstDateLong, fmtIstDateTimeZ, IST_LABEL } from "@/lib/datetime";

// Read-only status of ONE request, reached by the link shown after the requester confirmed (AUD-064). The token is the only credential:
// it is signed, stored only as a hash, bounded in views and expires. Never indexed, never cached, no personal data on the page.
export const metadata: Metadata = { title: "Request status", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function StatusPage({ params }: { params: Promise<{ ws: string; token: string }> }) {
  const { ws: slug, token: raw } = await params;
  const { t } = await getPrT();
  const shell = (title: string, body: string, extra?: React.ReactNode) => (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-3 px-4 py-10" data-testid="privacy-status">
      <h1 className="text-19 font-semibold text-ink">{title}</h1>
      <p className="text-14 text-ink-2" role="status">{body}</p>
      {extra}
      <Link href={`/privacy/${encodeURIComponent(slug)}`} className="text-13 font-medium text-accent underline">{t("verify.back")}</Link>
    </main>
  );
  if (!supabaseConfigured()) return shell(t("unavailable.title"), t("unavailable.body"));
  let v: Awaited<ReturnType<typeof viewStatus>>;
  try {
    const { dsrDeps } = await import("@/lib/privacy/runtime");
    v = await viewStatus(dsrDeps(), slug, decodeURIComponent(raw));
  } catch { return shell(t("status.invalidTitle"), t("export.unavailable")); }
  if (v.status === "expired") return shell(t("status.expiredTitle"), t("status.expiredBody"));
  if (v.status === "used") return shell(t("status.usedTitle"), t("status.usedBody"));
  if (v.status === "unavailable") return shell(t("status.invalidTitle"), t("export.unavailable"));
  if (v.status !== "ok") return shell(t("status.invalidTitle"), t("status.invalidBody"));

  const c = v.clock, n = Math.abs(c.daysLeft);
  const clockLine = c.state === "closed" ? t("status.closed")
    : c.daysLeft < 0 ? t(n === 1 ? "status.overdue1" : "status.overdue", { n })
    : c.daysLeft === 0 ? t("status.today") : t(c.daysLeft === 1 ? "status.left1" : "status.left", { n: c.daysLeft });
  const fmtDay = (iso: string) => `${fmtIstDateLong(iso) || iso} ${IST_LABEL}`;
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-3 px-4 py-10" data-testid="privacy-status" data-state={v.state}>
      <h1 className="text-19 font-semibold text-ink">{t("status.title")}</h1>
      <p className="text-14 text-ink-2">{t("status.sub", { org: v.orgName })}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-card border border-line bg-surface p-4 text-14">
        <dt className="text-ink-3">{t("status.kind")}</dt><dd className="text-ink">{t(`kind.${v.kind}`)}</dd>
        <dt className="text-ink-3">{t("status.state")}</dt><dd className="text-ink" data-testid="status-state">{t(`owner.status.${v.state}`)}</dd>
        <dt className="text-ink-3">{t("status.received")}</dt><dd className="num text-ink">{fmtIstDateTimeZ(v.receivedAt)}</dd>
        <dt className="text-ink-3">{t("status.due")}</dt><dd className="num text-ink">{fmtDay(v.dueAt)}</dd>
        {v.completedAt && <><dt className="text-ink-3">{t("status.completed")}</dt><dd className="num text-ink">{fmtIstDateTimeZ(v.completedAt)}</dd></>}
      </dl>
      <p className="text-14 font-medium text-ink" role="status" data-testid="status-clock">{clockLine}</p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line" aria-hidden><div className={`h-full ${c.state === "overdue" ? "bg-danger" : c.state === "due_soon" ? "bg-warn" : "bg-accent"}`} style={{ width: `${c.percent}%` }} /></div>
      <p className="text-13 text-ink-3">{t("status.clockNote")}</p>
      <Link href={`/privacy/${encodeURIComponent(slug)}`} className="text-13 font-medium text-accent underline">{t("verify.back")}</Link>
    </main>
  );
}
