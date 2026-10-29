import { requestPasswordReset } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { AuthAlert, AuthShell, authField } from "../_shell";

export const metadata = { title: "Reset password" };

export default async function Reset({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <AuthShell title="Reset your password" lead="Enter your work email and we will send a link if an account exists for it.">
      {sp.sent && <AuthAlert tone="info">If that address has an account, a reset link is on its way. It expires in one hour.</AuthAlert>}
      {sp.error === "email" && <AuthAlert>Enter a valid email address.</AuthAlert>}
      <form action={requestPasswordReset} className="space-y-3">
        <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Work email</span>
          <input name="email" type="email" autoComplete="email" required className={authField} /></label>
        <Button variant="primary" size="lg" className="w-full">Send reset link</Button>
      </form>
    </AuthShell>
  );
}
