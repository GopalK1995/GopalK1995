import type { Metadata } from "next";
import { PendingButton } from "@/components/ui/submit-button";
import Link from "next/link";
import { supabaseConfigured } from "@/lib/supabase/server";
import { VERIFY_TTL_MS, previewConfirm } from "@/lib/privacy/intake";
import { getPrT } from "@/lib/privacy/strings-server";
import { confirmVerification } from "../../../actions";
import { fmtIstDateLong, IST_LABEL } from "@/lib/datetime";

// The link in the verification email. GET never writes (mail scanners prefetch links): the person presses a button, which posts to a
// server action. The result comes back as a query-string outcome that carries no personal data.
export const metadata: Metadata = { title: "Confirm request", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

const fmtDue = (iso: string) => (fmtIstDateLong(iso) ? `${fmtIstDateLong(iso)} ${IST_LABEL}` : iso);

export default async function VerifyPage({ params, searchParams }: { params: Promise<{ ws: string; token: string }>; searchParams: Promise<{ r?: string; due?: string; k?: string; w?: string }> }) {
  const { ws: slug, token: raw } = await params, q = await searchParams;
  const { t } = await getPrT();
  const token = decodeURIComponent(raw);
  const shell = (title: string, body: string, extra?: React.ReactNode) => (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-3 px-4 py-10" data-testid="privacy-verify">
      <h1 className="text-19 font-semibold text-ink">{title}</h1>
      <p className="text-14 text-ink-2" role="status">{body}</p>
      {extra}
      <Link href={`/privacy/${encodeURIComponent(slug)}`} className="text-13 font-medium text-accent underline">{t("verify.back")}</Link>
    </main>
  );
  const hours = VERIFY_TTL_MS / 3_600_000;
  if (!supabaseConfigured()) return shell(t("unavailable.title"), t("unavailable.body"));

  const { intakeDeps } = await import("@/lib/privacy/runtime");
  const deps = intakeDeps(t);
  const p = await previewConfirm(deps, token);
  if (p.status === "expired") return shell(t("verify.expiredTitle"), t("verify.expiredBody", { hours }));
  if (p.status === "unavailable") return shell(t("verify.invalidTitle"), t("verify.unavailable"));
  if (p.status !== "ready") return shell(t("verify.invalidTitle"), t("verify.invalidBody"));
  if (p.slug !== slug) return shell(t("verify.invalidTitle"), t("verify.invalidBody"));

  const due = q.due ? fmtDue(q.due) : "";
  if (q.r === "created") return shell(t("verify.createdTitle"), `${t("verify.createdBody", { org: p.orgName, due })}${q.w === "1" ? ` ${t("verify.withdrawnBody")}` : ""}`);
  if (q.r === "duplicate") return shell(t("verify.duplicateTitle"), t("verify.duplicateBody", { org: p.orgName, due }));
  if (q.r === "rate_limited") return shell(t("verify.invalidTitle"), t("verify.rateLimited"));
  if (q.r === "unavailable") return shell(t("verify.invalidTitle"), t("verify.unavailable"));

  const confirm = confirmVerification.bind(null, slug, token);
  return shell(t("verify.title"), t("verify.ready", { org: p.orgName, kind: t(`kind.${p.kind}`).toLowerCase() }), (
    <form action={confirm}>
      <PendingButton className="h-9 rounded-control bg-accent px-4 text-14 font-medium text-accent-ink" data-testid="verify-confirm">{t("verify.confirm")}</PendingButton>
    </form>
  ));
}
