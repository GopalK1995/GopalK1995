import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { demoModeOn } from "@/lib/auth/cookies";
import { AdminLoginForm } from "../_components/admin-login-form";

export const metadata = { title: "Sign in" };

export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ step?: string; error?: string; signed_out?: string; next?: string }> }) {
  const sp = await searchParams;
  const demo = demoModeOn();
  const next = sp.next?.startsWith("/admin") ? sp.next : undefined;
  return (
    <div className="min-h-dvh bg-paper">
      <div className="bg-navy-950 text-navy-ink">
        <div className="mx-auto flex h-12 max-w-[1400px] items-center gap-2 px-4 text-[13px] sm:px-6 lg:px-8">
          <ShieldCheck className="size-4 text-accent-on-navy" aria-hidden /><span className="font-semibold">Platform admin</span><span className="text-navy-ink-3">· Synthan</span>
        </div>
      </div>
      <main className="mx-auto max-w-[400px] px-4 py-14">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Platform console sign-in</h1>
        <p className="mt-1 text-[13px] text-ink-2">For Synthan operators. Password plus a TOTP code; sessions idle out after 30 minutes.</p>
        {sp.signed_out && <p role="status" className="mt-4 rounded-sm border border-line bg-surface px-3 py-2 text-[13px] text-ink-2">Signed out of the platform console. Any open support session was ended.</p>}
        {sp.error === "live_admin" && <p role="alert" className="mt-4 rounded-sm border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger">Live admin sign-in needs Supabase Auth MFA, which is not enabled on this deployment.</p>}
        {sp.error === "not_admin" && <p role="alert" className="mt-4 rounded-sm border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger">Not a platform admin. You have been signed out.</p>}
        <AdminLoginForm startOnCode={sp.step === "code"} codeError={sp.error === "code"} next={next} demo={demo} />
        <p className="mt-8 border-t border-line pt-4 text-[12px] text-ink-3">Tenant user? <Link href="/login" className="font-medium text-accent hover:underline">Workspace sign-in</Link>. Platform admin accounts are separate from workspace accounts.</p>
      </main>
    </div>
  );
}
