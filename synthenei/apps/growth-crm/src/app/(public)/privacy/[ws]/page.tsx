import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/server";
import { buildNotice } from "@/lib/privacy/notice";
import { prAll } from "@/lib/privacy/strings";
import { getPrT } from "@/lib/privacy/strings-server";
import { REQUEST_KINDS } from "@/lib/privacy/types";
import { RequestForm } from "./_components/request-form";

// Public, tenant-branded notice and request form: /privacy/<workspace slug>. All wording that is specific to the organisation comes from
// the tenant row and tenant_config.config.privacy; nothing here names a tenant. Not indexed: it is linked from the organisation's own pages.
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: "Privacy", robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function PrivacyPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws: slug } = await params;
  const { t, locale } = await getPrT();
  if (!supabaseConfigured()) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-md content-center gap-3 px-4 py-10" data-testid="privacy-unavailable">
        <h1 className="text-19 font-semibold text-ink">{t("unavailable.title")}</h1>
        <p className="text-14 text-ink-2" role="status">{t("unavailable.body")}</p>
      </main>
    );
  }
  const { intakeDeps } = await import("@/lib/privacy/runtime");
  const ws = await intakeDeps(t).store.workspaceBySlug(slug);
  if (!ws) notFound();
  const notice = buildNotice(ws, t);
  return (
    <main className="mx-auto grid max-w-2xl gap-8 px-4 py-10" data-testid="privacy-page">
      <header className="grid gap-1">
        <p className="label-caps">{ws.orgName}</p>
        <h1 className="text-22 font-semibold text-ink">{notice.title}</h1>
        <p className="text-13 text-ink-3">{t("notice.version", { version: notice.version })}{notice.effective ? ` · ${t("notice.effective", { date: notice.effective })}` : ""}</p>
      </header>
      <article className="grid gap-5" data-testid="privacy-notice">
        {notice.sections.map((s) => (
          <section key={s.id} className="grid gap-1.5">
            <h2 className="text-15 font-semibold text-ink">{s.heading}</h2>
            {s.body.map((b, i) => <p key={i} className="text-14 text-ink-2 whitespace-pre-line">{b}</p>)}
          </section>
        ))}
      </article>
      <section className="grid gap-3 rounded-card border border-line bg-surface p-4" aria-labelledby="req-h">
        <div className="grid gap-1">
          <h2 id="req-h" className="text-15 font-semibold text-ink">{t("form.title")}</h2>
          <p className="text-13 text-ink-2">{t("form.sub")}</p>
        </div>
        <RequestForm workspace={ws.wsSlug} org={ws.orgName} kinds={[...REQUEST_KINDS]} s={prAll(locale)} />
      </section>
    </main>
  );
}
