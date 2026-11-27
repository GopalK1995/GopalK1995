import { requestPasswordReset } from "@/lib/auth/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { AuthAlert, AuthShell, authField } from "../_shell";
import { getT, pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("reset");

export default async function Reset({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const sp = await searchParams;
  const t = await getT("auth");
  return (
    <AuthShell back={t("shell.backToSignIn")} title={t("reset.title")} lead={t("reset.lead")}>
      {sp.sent && <AuthAlert tone="info">{t("reset.sent")}</AuthAlert>}
      {sp.error === "email" && <AuthAlert>{t("reset.badEmail")}</AuthAlert>}
      <form action={requestPasswordReset} className="space-y-3">
        <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{t("reset.email")}</span>
          <input name="email" type="email" autoComplete="email" required className={authField} /></label>
        <SubmitButton variant="primary" size="lg" className="w-full" pendingLabel={t("reset.sending")}>{t("reset.send")}</SubmitButton>
      </form>
    </AuthShell>
  );
}
