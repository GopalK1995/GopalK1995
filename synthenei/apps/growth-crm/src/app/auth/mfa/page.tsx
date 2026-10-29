import { KeyRound } from "lucide-react";
import { verifyMfa } from "@/lib/auth/actions";
import { safeNext } from "@/lib/auth/cookies";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { AuthAlert, AuthShell, authField } from "../_shell";

export const metadata = { title: "Two-step verification" };

/** TOTP step. Challenge mode verifies an enrolled factor; enrol mode starts a new factor (platform admins must, org owners may). */
export default async function Mfa({ searchParams }: { searchParams: Promise<{ enrol?: string; next?: string; via?: string; error?: string }> }) {
  const sp = await searchParams;
  const sb = await createSupabaseServerClient();
  const user = sb ? (await sb.auth.getUser()).data.user : null;
  if (!sb || !user) return <AuthShell title="Two-step verification"><AuthAlert>Sign in first, then come back to set up two-step verification.</AuthAlert></AuthShell>;

  const { data: factors } = await sb.auth.mfa.listFactors();
  const verified = factors?.totp?.find((f) => f.status === "verified");
  let factorId = verified?.id ?? "", qr = "", secret = "";
  const enrol = sp.enrol === "1" && !verified;
  if (enrol) {
    // Drop abandoned, never-verified factors so repeated visits do not pile up.
    for (const f of factors?.all ?? []) if (f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
    if (error || !data) return <AuthShell title="Set up two-step verification"><AuthAlert>We could not start setup. Try again in a minute.</AuthAlert></AuthShell>;
    factorId = data.id; qr = data.totp.qr_code; secret = data.totp.secret;
  }
  return (
    <AuthShell title={enrol ? "Set up two-step verification" : "Enter your code"} lead={enrol ? "Scan the QR code with an authenticator app, then enter the 6-digit code it shows." : "Open your authenticator app and enter the current 6-digit code."}>
      {sp.error && <AuthAlert>That code was not accepted. Enter the current code from your authenticator.</AuthAlert>}
      {enrol && (
        <div className="mb-4 rounded-md border border-line bg-surface p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- data: SVG from Supabase */}
          <img src={qr} alt="QR code for your authenticator app" width={176} height={176} className="mx-auto" />
          <p className="mt-3 text-[12px] text-ink-3">Cannot scan? Enter this key manually:</p>
          <code data-testid="totp-secret" className="mt-1 block break-all rounded-sm bg-paper-2 px-2 py-1 text-[12px]">{secret}</code>
        </div>
      )}
      <form action={verifyMfa} className="space-y-3">
        <input type="hidden" name="factorId" value={factorId} />
        {enrol && <input type="hidden" name="enrol" value="1" />}
        <input type="hidden" name="next" value={safeNext(sp.next) ?? ""} />
        <input type="hidden" name="via" value={sp.via ?? ""} />
        <label className="block"><span className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink-2"><KeyRound className="size-3.5" aria-hidden />6-digit code</span>
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus className={authField + " text-center font-mono text-[20px] tracking-[0.4em]"} placeholder="000000" /></label>
        <Button variant="primary" size="lg" className="w-full">{enrol ? "Verify and finish setup" : "Verify and sign in"}</Button>
      </form>
    </AuthShell>
  );
}
