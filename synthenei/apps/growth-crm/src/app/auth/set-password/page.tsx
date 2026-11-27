import { setPassword } from "@/lib/auth/actions";
import { safeNext } from "@/lib/auth/cookies";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/ui/submit-button";
import { AuthAlert, AuthShell, authField } from "../_shell";
import { getT, pageTitle } from "@/i18n/server";
import { PasswordFields } from "./password-fields";

export const generateMetadata = pageTitle("setPassword");
const ERR_KEYS = ["short", "long", "common", "context", "mismatch", "failed"];

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
        <PasswordFields fieldClass={authField} labels={{ password: t("setPassword.newPassword"), confirm: t("setPassword.confirm"), hint: t("setPassword.hint"), counter: t("setPassword.counter", { count: "{count}" }), counterOk: t("setPassword.counterOk", { count: "{count}" }) }} />
        <SubmitButton variant="primary" size="lg" className="w-full" pendingLabel={t("setPassword.saving")}>{t("setPassword.save")}</SubmitButton>
      </form>
    </AuthShell>
  );
}
