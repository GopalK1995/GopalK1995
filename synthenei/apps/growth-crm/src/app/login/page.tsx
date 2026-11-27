import Link from "next/link";
import { ArrowRight, BarChart3, Briefcase, Building2, Database, Eye, Megaphone, ShieldCheck, UserRound } from "lucide-react";
import { demoLogin, passwordLogin } from "@/lib/auth/actions";
import { PERSONAS, TENANTS, WORKSPACES, userById } from "@/lib/tenancy";
import { datasetFor } from "@/lib/data/mock/generate-index";
import { supabaseConfigured } from "@/lib/supabase/server";
import { demoModeOn } from "@/lib/auth/cookies";
import { loadEnv } from "@/lib/env";
import { headers } from "next/headers";
import { platformBrand, resolvePublicBrand, type PublicBrand } from "@/lib/brand/public-brand";
import { PendingButton, SubmitButton } from "@/components/ui/submit-button";
import { vocabFor } from "@/lib/vertical";
import { LegalFooter } from "@/components/legal/legal-page";
import { getLocale, getT, pageTitle } from "@/i18n/server";
import { platformName } from "@/lib/brand/platform";

export const generateMetadata = pageTitle("signIn");
const ICON: Record<string, typeof UserRound> = { "owner-lawsome": Briefcase, "mgr-lawsome": BarChart3, "rep-lawsome": UserRound, "mkt-lawsome": Megaphone, "owner-kaveri": Building2, super: ShieldCheck, "data-lawsome": Database, "viewer-lawsome": Eye };
const ERR_KEYS = ["credentials", "no_backend", "inactive", "no_profile", "revoked", "link", "throttled", "role", "demo_disabled"];

function Mono({ letter, logoUrl, size = 32 }: { letter: string; logoUrl?: string | null; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element -- tenant logo from a validated https URL, decorative (the name sits beside it)
  if (logoUrl) return <img src={logoUrl} alt="" width={size} height={size} className="shrink-0 rounded-[6px] object-contain" />;
  return <span aria-hidden className="grid shrink-0 place-items-center rounded-[6px] bg-accent font-semibold text-accent-ink" style={{ width: size, height: size, fontSize: size * 0.46 }}>{letter}</span>;
}

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; signed_out?: string; t?: string }> }) {
  const sp = await searchParams;
  const t = await getT("auth");
  const locale = (await getLocale()) === "ta" ? "ta" : "en";
  const live = supabaseConfigured();
  const demo = demoModeOn();
  // Fixture tenants (sample data, client names, the demo hub hint) exist only in demo/dev, never in production (AUD-026).
  const showDemo = demo && loadEnv().appEnv !== "production";
  // ?t=<slug> previews a tenant's login; otherwise the tenant is resolved from the host (custom domain). Nothing identified: neutral.
  const host = (await headers()).get("host");
  const fixture = showDemo ? TENANTS.find((x) => x.id === sp.t) ?? TENANTS[0] : null;
  const ws = fixture ? WORKSPACES.find((w) => w.tenantId === fixture.id)! : null;
  const d = ws ? datasetFor(ws.dataset) : null;
  const districts = d ? new Set(d.accounts.map((a) => a.district)).size : 0;
  const lv = fixture ? vocabFor(fixture).login : null;
  const dbBrand = fixture ? null : await resolvePublicBrand(sp.t ? { slug: sp.t } : { host });
  const brand: PublicBrand = dbBrand ?? (fixture ? { source: "platform", slug: fixture.id, name: fixture.name, monogram: fixture.monogram, hue: fixture.hue, logoUrl: null } : platformBrand());
  const product = fixture?.product ?? null;
  // Credential and throttle errors belong to the email/password fields: mark them invalid and point them at the message.
  const fieldErr = sp.error === "credentials" || sp.error === "throttled" ? { "aria-invalid": true as const, "aria-describedby": "login-error" } : {};
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(420px,5fr)_7fr]">
      <style>{`:root{--brand-h:${brand.hue}}`}</style>
      {/* 30%: navy structure panel with a real product fact sheet, not a slogan */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-navy-900 p-10 text-navy-ink lg:flex">
        <div className="flex items-center gap-3"><Mono letter={brand.monogram} logoUrl={brand.logoUrl} /><div><div className="text-[15px] font-semibold tracking-[0.02em]">{brand.name}</div>{product && <div className="text-[12px] text-navy-ink-3">{product}</div>}</div></div>
        {fixture && ws && d && lv ? (
          <>
            <div className="max-w-sm">
              <p className="text-[24px] font-semibold leading-8 tracking-[-0.02em]">{lv.line}</p>
              <div className="mt-8 mb-2 text-[11px] uppercase tracking-[0.08em] text-navy-ink-3">{ws.name} workspace · sample data</div>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-navy-line bg-navy-line text-[12px]">
                {lv.facts(d.leads.length, d.accounts.length, d.deals.filter((x) => x.stage !== "won" && x.stage !== "lost").length, `${districts} · ${ws.region.split(" · ").slice(0, 3).join(", ")}`).map(([k, v]) => (
                  <div key={k} className="bg-navy-900 p-3"><dt className="text-navy-ink-3">{k}</dt><dd className="mt-1 font-medium text-navy-ink num">{v}</dd></div>
                ))}
              </dl>
            </div>
            <p className="text-[11px] leading-4 text-navy-ink-3">{lv.foot}</p>
          </>
        ) : <div aria-hidden />}
      </aside>

      <main className="flex items-start justify-center px-4 py-10 sm:px-8 lg:items-center">
        <div className="w-full max-w-[560px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden"><Mono letter={brand.monogram} logoUrl={brand.logoUrl} /><div><div className="text-[15px] font-semibold">{brand.name}</div>{product && <div className="text-[12px] text-ink-3">{product}</div>}</div></div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{t("login.title")}</h1>
          {showDemo && <p className="mt-1 text-[12px] text-ink-3">{t("login.hub")}</p>}
          <p className="mt-1 text-[13px] text-ink-2">{sp.signed_out ? t("login.signedOut") : demo ? t("login.intro") : t("login.introLive")}</p>
          {sp.error && <p id="login-error" role="alert" className="mt-4 rounded-sm border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger">{ERR_KEYS.includes(sp.error) ? t(`login.errors.${sp.error}`) : t("login.generic")}</p>}

          <form action={passwordLogin} className="mt-6 space-y-3">
            <input type="hidden" name="next" value={sp.next ?? ""} />
            <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{t("login.workEmail")}</span>
              <input name="email" type="email" autoComplete="email" required {...fieldErr} placeholder={lv?.emailPh ?? t("login.emailPlaceholder")} disabled={!live} className="h-10 w-full rounded-sm border border-field-line bg-surface px-3 text-[14px] focus-ring placeholder:text-ink-3 focus:border-ring disabled:bg-paper-2 disabled:text-ink-3" /></label>
            <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{t("password")}</span>
              <input name="password" type="password" autoComplete="current-password" required {...fieldErr} disabled={!live} className="h-10 w-full rounded-sm border border-field-line bg-surface px-3 text-[14px] focus-ring focus:border-ring disabled:bg-paper-2" /></label>
            <SubmitButton variant="primary" size="lg" className="w-full" disabled={!live} pendingLabel={t("login.signingIn")}>{t("login.title")}</SubmitButton>
            {live && <p className="text-[12px]"><Link href="/auth/reset" className="font-medium text-accent hover:underline">{t("forgotPassword")}</Link></p>}
            {!live && showDemo && <p className="text-[12px] text-ink-3">{t("login.noBackend")}</p>}
          </form>

          {demo && (
            <section className="mt-8" aria-labelledby="demo-h">
              <div className="mb-3 flex items-center gap-3"><h2 id="demo-h" className="eyebrow">{t("login.demoHeading")}</h2><span className="rounded-[3px] border border-dashed border-line-strong px-1.5 text-[10px] text-ink-3">{t("login.demoNote")}</span><span className="h-px flex-1 bg-line" /></div>
              <div className="grid gap-2 sm:grid-cols-2">
                {PERSONAS.filter((p) => !p.secondary).map((p) => {
                  const I = ICON[p.key] ?? UserRound;
                  return (
                    <form key={p.key} action={demoLogin}>
                      <input type="hidden" name="persona" value={p.key} /><input type="hidden" name="next" value={sp.next ?? ""} />
                      <PendingButton data-persona={p.key} className="group flex h-full w-full items-start gap-3 rounded-md border border-line bg-surface p-3 text-left shadow-1 transition-[border-color,transform] duration-150 ease-out hover:-translate-y-px hover:border-accent focus-visible:border-accent">
                        <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-paper-2 text-ink-2 group-hover:bg-accent-soft group-hover:text-accent"><I className="size-4" aria-hidden /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2"><span className="text-[13px] font-semibold text-ink">{p.label}</span><ArrowRight className="size-3.5 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden /></span>
                          <span className="block text-[12px] leading-4 text-ink-3">{p.detail}</span>
                          <span className="mt-1 block text-[11px] text-ink-3">{t("login.as", { name: userById(p.userId)?.name ?? "" })}</span>
                        </span>
                      </PendingButton>
                    </form>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
                <span>{t("login.moreRoles")}</span>
                {PERSONAS.filter((p) => p.secondary).map((p) => (
                  <form key={p.key} action={demoLogin}><input type="hidden" name="persona" value={p.key} /><PendingButton data-persona={p.key} className="font-medium text-accent hover:underline">{p.label}</PendingButton></form>
                ))}
              </div>
            </section>
          )}
          <div className="mt-8 flex items-center justify-between border-t border-line pt-4 text-[12px] text-ink-3">
            <span>{t("login.staff", { platform: platformName(locale) })}</span>
            <Link href="/admin/login" className="inline-flex items-center gap-1.5 font-medium text-ink-2 hover:text-accent"><ShieldCheck className="size-3.5" aria-hidden />{t("login.platformAdmin")}</Link>
          </div>
          <LegalFooter className="mt-3" />
        </div>
      </main>
    </div>
  );
}
