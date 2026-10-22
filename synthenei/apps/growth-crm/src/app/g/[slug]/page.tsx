// Branded, public sign-in link per client: /g/<slug>. Lists only the personas of that tenant and themes the page with
// that tenant's hue. No session is needed; signing in goes through the same server actions as /login.
import { notFound } from "next/navigation";
import { ArrowRight, BarChart3, Briefcase, Eye, Megaphone, UserRound, Database, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import { demoLogin, passwordLogin } from "@/lib/auth/actions";
import { MEMBERSHIPS, PERSONAS, TENANTS, WORKSPACES, userById } from "@/lib/tenancy";
import { datasetFor } from "@/lib/data/mock/generate-index";
import { supabaseConfigured } from "@/lib/supabase/server";
import { demoModeOn } from "@/lib/auth/cookies";
import { SIGNIN_SLUGS, vocabFor } from "@/lib/vertical";
import { Button } from "@/components/ui/button";
import type { Role } from "@/lib/data/types";

const ROLE_ICON: Record<Role, LucideIcon> = { owner: Briefcase, sales_manager: BarChart3, sales_rep: UserRound, marketing: Megaphone, data: Database, viewer: Eye };
const ERR: Record<string, string> = {
  credentials: "Email or password is incorrect.", no_backend: "Password sign-in needs the Supabase backend. Use a demo role below.",
  inactive: "Your access was removed by your admin.", no_profile: "You are signed in but not invited to a workspace.", wrong_tenant: "That account does not belong to this organisation.", revoked: "Your access to that workspace was removed. Sign in again.",
  role: "Pick one of the roles below.", demo_disabled: "Demo roles are disabled on this deployment.",
};
const tenantFor = (slug: string) => ((SIGNIN_SLUGS as readonly string[]).includes(slug) ? TENANTS.find((t) => t.id === slug) : undefined);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const t = tenantFor((await params).slug);
  if (!t) return { title: "Sign in" };
  // Set explicitly so link previews (WhatsApp, Slack) never show another client's name before anyone is signed in.
  const title = `Sign in · ${t.name}`;
  const description = t.vertical === "hospitality"
    ? `${t.name}: enquiries, bookings and campaigns in one place (sample data).`
    : `${t.name}: leads, pipeline and campaigns in one place (sample data).`;
  return { title: { absolute: title }, description, openGraph: { title, description, type: "website" }, robots: { index: false, follow: false } };
}

function Mono({ letter, size = 32 }: { letter: string; size?: number }) {
  return <span aria-hidden className="grid shrink-0 place-items-center rounded-[6px] bg-accent font-semibold text-accent-ink" style={{ width: size, height: size, fontSize: size * 0.46 }}>{letter}</span>;
}

export default async function ClientSignIn({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; next?: string; signed_out?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const tenant = tenantFor(slug);
  if (!tenant) notFound();
  const v = vocabFor(tenant), lv = v.login;
  const ws = WORKSPACES.find((w) => w.tenantId === tenant.id)!;
  const d = datasetFor(ws.dataset);
  const towns = new Set(d.accounts.map((a) => a.district)).size;
  const personas = PERSONAS.filter((p) => p.tenantId === tenant.id);
  const roleOf = (userId: string) => MEMBERSHIPS.find((m) => m.userId === userId)?.role ?? "viewer";
  const live = supabaseConfigured(), demo = demoModeOn();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(420px,5fr)_7fr]">
      <style>{`:root{--brand-h:${tenant.hue}}`}</style>
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-navy-900 p-10 text-navy-ink lg:flex">
        <div className="flex items-center gap-3"><Mono letter={tenant.monogram} /><div><div className="text-[15px] font-semibold tracking-[0.02em]">{tenant.name}</div><div className="text-[12px] text-navy-ink-3">{tenant.product}</div></div></div>
        <div className="max-w-sm">
          <p className="text-[24px] font-semibold leading-8 tracking-[-0.02em]">{lv.line}</p>
          <div className="mt-8 mb-2 text-[11px] uppercase tracking-[0.08em] text-navy-ink-3">{ws.name} · sample data</div>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-navy-line bg-navy-line text-[12px]">
            {lv.facts(d.leads.length, d.accounts.length, d.deals.filter((x) => x.stage !== "won" && x.stage !== "lost").length, `${towns} · ${ws.region.split(" · ").slice(0, 3).join(", ")}`).map(([k, val]) => (
              <div key={k} className="bg-navy-900 p-3"><dt className="text-navy-ink-3">{k}</dt><dd className="mt-1 font-medium text-navy-ink num">{val}</dd></div>
            ))}
          </dl>
        </div>
        <p className="text-[11px] leading-4 text-navy-ink-3">{lv.foot}</p>
      </aside>

      <main className="flex items-start justify-center px-4 py-10 sm:px-8 lg:items-center">
        <div className="w-full max-w-[560px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden"><Mono letter={tenant.monogram} /><div><div className="text-[15px] font-semibold">{tenant.name}</div><div className="text-[12px] text-ink-3">{tenant.product}</div></div></div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Sign in to {tenant.name}</h1>
          <p className="mt-1 text-[13px] text-ink-2">{sp.signed_out ? "You have been signed out." : lv.short}</p>
          {sp.error && <p role="alert" className="mt-4 rounded-sm border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger">{ERR[sp.error] ?? "Sign-in failed."}</p>}

          <form action={passwordLogin} className="mt-6 space-y-3">
            <input type="hidden" name="next" value={sp.next ?? ""} /><input type="hidden" name="tenant" value={tenant.id} />
            <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Work email</span>
              <input name="email" type="email" autoComplete="email" required placeholder={lv.emailPh} disabled={!live} className="h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-[14px] outline-none placeholder:text-ink-3 focus:border-ring disabled:bg-paper-2 disabled:text-ink-3" /></label>
            <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Password</span>
              <input name="password" type="password" autoComplete="current-password" required disabled={!live} className="h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-[14px] outline-none focus:border-ring disabled:bg-paper-2" /></label>
            <Button variant="primary" size="lg" className="w-full" disabled={!live}>Sign in</Button>
            {!live && <p className="text-[12px] text-ink-3">Password sign-in activates when the Supabase project is connected. This deployment runs in demo mode.</p>}
          </form>

          {demo && (
            <section className="mt-8" aria-labelledby="demo-h">
              <div className="mb-3 flex items-center gap-3"><h2 id="demo-h" className="eyebrow">Open the demo as</h2><span className="h-px flex-1 bg-line" /></div>
              <div className="grid gap-2 sm:grid-cols-2">
                {personas.map((p) => {
                  const I = ROLE_ICON[roleOf(p.userId)];
                  return (
                    <form key={p.key} action={demoLogin}>
                      <input type="hidden" name="persona" value={p.key} /><input type="hidden" name="next" value={sp.next ?? ""} />
                      <button data-persona={p.key} className="group flex h-full w-full items-start gap-3 rounded-md border border-line bg-surface p-3 text-left shadow-1 transition-[border-color,transform] duration-150 ease-out hover:-translate-y-px hover:border-accent focus-visible:border-accent">
                        <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-paper-2 text-ink-2 group-hover:bg-accent-soft group-hover:text-accent"><I className="size-4" aria-hidden /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2"><span className="text-[13px] font-semibold text-ink">{p.label}</span><ArrowRight className="size-3.5 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden /></span>
                          <span className="block text-[12px] leading-4 text-ink-3">{p.detail}</span>
                          <span className="mt-1 block text-[11px] text-ink-3">as {userById(p.userId)?.name}</span>
                        </span>
                      </button>
                    </form>
                  );
                })}
              </div>
              <p className="mt-3 text-[12px] text-ink-3">Demo sessions read sample data only.</p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
