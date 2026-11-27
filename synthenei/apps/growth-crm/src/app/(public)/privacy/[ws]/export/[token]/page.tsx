import type { Metadata } from "next";
import Link from "next/link";
import { PendingButton } from "@/components/ui/submit-button";
import { supabaseConfigured } from "@/lib/supabase/server";
import { previewExport } from "@/lib/privacy/dsr";
import { getPrT } from "@/lib/privacy/strings-server";

// Delivery page for an access bundle (AUD-064, PRIV-023). GET never spends the link and shows no data: it asks for the email address used
// for the request. The form POSTs to ./download, which re-checks the address, spends the link and streams the file once.
export const metadata: Metadata = { title: "Your data export", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function ExportPage({ params, searchParams }: { params: Promise<{ ws: string; token: string }>; searchParams: Promise<{ e?: string }> }) {
  const { ws: slug, token: raw } = await params, q = await searchParams;
  const { t } = await getPrT();
  const token = decodeURIComponent(raw);
  const shell = (title: string, body: string, extra?: React.ReactNode, tone: "info" | "error" = "info") => (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-3 px-4 py-10" data-testid="privacy-export">
      <h1 className="text-19 font-semibold text-ink">{title}</h1>
      <p className={`text-14 ${tone === "error" ? "text-danger" : "text-ink-2"}`} role="status">{body}</p>
      {extra}
      <Link href={`/privacy/${encodeURIComponent(slug)}`} className="text-13 font-medium text-accent underline">{t("verify.back")}</Link>
    </main>
  );
  if (!supabaseConfigured()) return shell(t("unavailable.title"), t("unavailable.body"));
  let p: Awaited<ReturnType<typeof previewExport>>;
  try { const { dsrDeps } = await import("@/lib/privacy/runtime"); p = await previewExport(dsrDeps(), slug, token); } catch { return shell(t("export.invalidTitle"), t("export.unavailable")); }
  if (p.status === "expired") return shell(t("export.expiredTitle"), t("export.expiredBody"));
  if (p.status === "used") return shell(t("export.usedTitle"), t("export.usedBody"));
  if (p.status === "unavailable") return shell(t("export.invalidTitle"), t("export.unavailable"));
  if (p.status !== "ready") return shell(t("export.invalidTitle"), t("export.invalidBody"));
  const err = q.e === "email" ? t("export.wrongEmail") : q.e === "rate" ? t("export.rateLimited") : q.e === "nolead" ? t("export.noRecord") : q.e ? t("export.unavailable") : "";
  return shell(t("export.title"), t("export.body", { org: p.orgName }), (
    <form method="post" action={`/privacy/${encodeURIComponent(slug)}/export/${encodeURIComponent(token)}/download`} className="grid gap-2">
      <label htmlFor="export-email" className="text-13 font-medium text-ink">{t("export.emailLabel")}</label>
      <input id="export-email" name="email" type="email" required autoComplete="email" className="h-9 rounded-control border border-line-strong bg-surface px-3 text-14 text-ink" data-testid="export-email" aria-invalid={err ? true : undefined} aria-describedby={err ? "export-err" : undefined} />
      {err && <p id="export-err" role="alert" className="text-13 text-danger" data-testid="export-error">{err}</p>}
      <PendingButton className="h-9 rounded-control bg-accent px-4 text-14 font-medium text-accent-ink" data-testid="export-download">{t("export.confirm")}</PendingButton>
    </form>
  ));
}
