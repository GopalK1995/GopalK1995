import { setPassword } from "@/lib/auth/actions";
import { safeNext } from "@/lib/auth/cookies";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { AuthAlert, AuthShell, authField } from "../_shell";

export const metadata = { title: "Set password" };
const ERR: Record<string, string> = {
  short: "Use at least 10 characters.", weak: "Include at least one letter and one number.",
  mismatch: "The two passwords do not match.", failed: "We could not save that password. Try a different one.",
};

export default async function SetPassword({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  const sb = await createSupabaseServerClient();
  const user = sb ? (await sb.auth.getUser()).data.user : null;
  if (!user) return <AuthShell title="Link expired"><AuthAlert>This link has expired or was already used. Ask for a new invitation or reset your password.</AuthAlert></AuthShell>;
  return (
    <AuthShell title="Choose a password" lead={`Signing in as ${user.email ?? "your account"}.`}>
      {sp.error && <AuthAlert>{ERR[sp.error] ?? ERR.failed}</AuthAlert>}
      <form action={setPassword} className="space-y-3">
        <input type="hidden" name="next" value={safeNext(sp.next) ?? ""} />
        <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">New password</span>
          <input name="password" type="password" autoComplete="new-password" minLength={10} required className={authField} /></label>
        <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Confirm password</span>
          <input name="confirm" type="password" autoComplete="new-password" minLength={10} required className={authField} /></label>
        <p className="text-[12px] text-ink-3">At least 10 characters, with a letter and a number.</p>
        <Button variant="primary" size="lg" className="w-full">Save password and continue</Button>
      </form>
    </AuthShell>
  );
}
