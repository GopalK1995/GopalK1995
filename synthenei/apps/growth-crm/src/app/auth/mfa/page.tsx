import { KeyRound } from "lucide-react";
import { verifyMfa } from "@/lib/auth/actions";
import { safeNext } from "@/lib/auth/cookies";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/ui/submit-button";
import { AuthAlert, AuthShell, authField } from "../_shell";
import { getT, pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("mfa");

/** TOTP step. Challenge mode verifies an enrolled factor; enrol mode starts a new factor (platform admins and privileged tenant roles must, see lib/auth/mfa-policy.ts). */
export default async function Mfa({ searchParams }: { searchParams: Promise<{ enrol?: string; next?: string; via?: string; error?: string }> }) {
  const sp = await searchParams;
  const t = await getT("auth");
  const sb = await createSupabaseServerClient();
  const user = sb ? (await sb.auth.getUser()).data.user : null;
  if (!sb || !user) return <AuthShell back={t("shell.backToSignIn")} title={t("mfa.title")}><AuthAlert>{t("mfa.signInFirst")}</AuthAlert></AuthShell>;

  const { data: factors } = await sb.auth.mfa.listFactors();
  const verified = factors?.totp?.find((f) => f.status === "verified");
  let factorId = verified?.id ?? "", qr = "", secret = "";
  const enrol = sp.enrol === "1" && !verified;
  if (enrol) {
    // Drop abandoned, never-verified factors so repeated visits do not pile up.
    for (const f of factors?.all ?? []) if (f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
    if (error || !data) return <AuthShell back={t("shell.backToSignIn")} title={t("mfa.setupTitle")}><AuthAlert>{t("mfa.setupFailed")}</AuthAlert></AuthShell>;
    factorId = data.id; qr = data.totp.qr_code; secret = data.totp.secret;
  }
  return (
    <AuthShell back={t("shell.backToSignIn")} title={enrol ? t("mfa.setupTitle") : t("mfa.enterCode")} lead={enrol ? t("mfa.requiredLead") : t("mfa.codeLead")}>
      {sp.error && <AuthAlert id="mfa-error">{t("mfa.badCode")}</AuthAlert>}
      {enrol && (
        <div className="mb-4 rounded-md border border-line bg-surface p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- data: SVG from Supabase */}
          <img src={qr} alt={t("mfa.qrAlt")} width={176} height={176} className="mx-auto" />
          <p className="mt-3 text-[12px] text-ink-3">{t("mfa.cannotScan")}</p>
          <code data-testid="totp-secret" className="mt-1 block break-all rounded-sm bg-paper-2 px-2 py-1 text-[12px]">{secret}</code>
        </div>
      )}
      <form action={verifyMfa} className="space-y-3">
        <input type="hidden" name="factorId" value={factorId} />
        {enrol && <input type="hidden" name="enrol" value="1" />}
        <input type="hidden" name="next" value={safeNext(sp.next) ?? ""} />
        <input type="hidden" name="via" value={sp.via ?? ""} />
        <label className="block"><span className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink-2"><KeyRound className="size-3.5" aria-hidden />{t("mfa.codeLabel")}</span>
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus aria-invalid={sp.error ? true : undefined} aria-describedby={sp.error ? "mfa-error" : undefined} className={authField + " text-center font-mono text-[20px] tracking-[0.4em]"} placeholder="000000" /></label>
        <SubmitButton variant="primary" size="lg" className="w-full" pendingLabel={t("mfa.verifying")}>{enrol ? t("mfa.verifyFinish") : t("mfa.verifySignIn")}</SubmitButton>
      </form>
    </AuthShell>
  );
}
