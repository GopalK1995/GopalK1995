import { setPassword } from "@/lib/auth/actions";
import { safeNext } from "@/lib/auth/cookies";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/ui/submit-button";
import { AuthAlert, AuthShell, authField } from "../_shell";
import { getT, pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("setPassword");
const ERR_KEYS = ["short", "weak", "mismatch", "failed"];

export default async function SetPassword({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  const t = await getT("auth");
  const sb = await createSupabaseServerClient();
  const user = sb ? (await sb.auth.getUser()).data.user : null;
  if (!user) return <AuthShell back={t("shell.backToSignIn")} title={t("setPassword.expiredTitle")}><AuthAlert>{t("setPassword.expired")}</AuthAlert></AuthShell>;
  return (
    <AuthShell back={t("shell.backToSignIn")} title={t("setPassword.title")} lead={t("setPassword.lead", { email: user.email ?? t("setPassword.yourAccount") })}>
      {sp.error && <AuthAlert>{t(`setPassword.errors.${ERR_KEYS.includes(sp.error) ? sp.error : "failed"}`)}</AuthAlert>}
      <form action={setPassword} className="space-y-3">
        <input type="hidden" name="next" value={safeNext(sp.next) ?? ""} />
        <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{t("setPassword.newPassword")}</span>
          <input name="password" type="password" autoComplete="new-password" minLength={10} required className={authField} /></label>
        <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{t("setPassword.confirm")}</span>
          <input name="confirm" type="password" autoComplete="new-password" minLength={10} required className={authField} /></label>
        <p className="text-[12px] text-ink-3">{t("setPassword.hint")}</p>
        <SubmitButton variant="primary" size="lg" className="w-full" pendingLabel={t("setPassword.saving")}>{t("setPassword.save")}</SubmitButton>
      </form>
    </AuthShell>
  );
}
