import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";
import { adminLogin } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Platform admin sign-in" };
const field = "h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-[14px] outline-none placeholder:text-ink-3 focus:border-ring";

export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ step?: string; error?: string; signed_out?: string }> }) {
  const sp = await searchParams;
  const codeStep = sp.step === "code";
  return (
    <div className="min-h-dvh bg-paper">
      <div className="flex h-12 items-center gap-2 bg-navy-950 px-4 text-[12px] text-navy-ink-2 sm:px-8">
        <ShieldCheck className="size-4 text-accent-on-navy" aria-hidden /><span className="font-semibold text-navy-ink">Synthan</span><span className="text-navy-ink-3">Platform admin</span>
      </div>
      <main className="mx-auto max-w-[400px] px-4 py-14">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{codeStep ? "Enter your 6-digit code" : "Platform admin sign-in"}</h1>
        <p className="mt-1 text-[13px] text-ink-2">{codeStep ? "From your authenticator app. Codes rotate every 30 seconds." : "For Synthan operators only. Tenant users sign in on the workspace login."}</p>
        {sp.signed_out && <p className="mt-4 text-[13px] text-ink-2">You have been signed out.</p>}
        {sp.error && <p role="alert" className="mt-4 rounded-sm border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger">{sp.error === "code" ? "Enter the 6 digits from your authenticator." : "Live admin sign-in needs Supabase MFA, which is not enabled on this deployment."}</p>}
        {!codeStep ? (
          <form action="/admin/login" className="mt-6 space-y-3">
            <input type="hidden" name="step" value="code" />
            <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Email</span><input name="email" type="email" required defaultValue="vikram@synthan.example" className={field} /></label>
            <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Password</span><input name="password" type="password" required defaultValue="demo-password" className={field} /></label>
            <Button variant="navy" size="lg" className="w-full">Continue</Button>
          </form>
        ) : (
          <form action={adminLogin} className="mt-6 space-y-3">
            <label className="block"><span className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink-2"><KeyRound className="size-3.5" aria-hidden />Authentication code</span>
              <input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoFocus placeholder="000000" defaultValue="482915" className={field + " text-center font-mono text-[20px] tracking-[0.4em]"} /></label>
            <Button variant="navy" size="lg" className="w-full">Verify and sign in</Button>
            <p className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3"><span className="rounded-[3px] border border-dashed border-warn/60 bg-warn-soft px-1.5 py-0.5 font-medium text-warn-ink">Demo — any 6-digit code</span>Not real MFA. Signs in as Vikram Anand (Synthan).</p>
          </form>
        )}
        <p className="mt-8 border-t border-line pt-4 text-[12px] text-ink-3">Tenant user? <Link href="/login" className="font-medium text-accent hover:underline">Workspace sign-in</Link></p>
      </main>
    </div>
  );
}
