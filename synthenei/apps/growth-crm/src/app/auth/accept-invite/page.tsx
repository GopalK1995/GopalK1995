import { acceptInvite } from "@/lib/auth/actions";
import { safeNext } from "@/lib/auth/cookies";
import { SubmitButton } from "@/components/ui/submit-button";
import { AuthAlert, AuthShell } from "../_shell";
import { getT, pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("acceptInvite");

/** The emailed link opens here. The token is only spent when the person presses the button, so mail scanners cannot use it up. */
export default async function AcceptInvite({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string; next?: string }> }) {
  const sp = await searchParams;
  const t = await getT("auth");
  if (!sp.token_hash) return <AuthShell back={t("shell.backToSignIn")} title={t("invite.incompleteTitle")}><AuthAlert>{t("invite.incomplete")}</AuthAlert></AuthShell>;
  return (
    <AuthShell back={t("shell.backToSignIn")} title={t("invite.title")} lead={t("invite.lead")}>
      <form action={acceptInvite} className="space-y-3">
        <input type="hidden" name="token_hash" value={sp.token_hash} />
        <input type="hidden" name="type" value={sp.type === "recovery" ? "recovery" : "invite"} />
        <input type="hidden" name="next" value={safeNext(sp.next) ?? ""} />
        <SubmitButton variant="primary" size="lg" className="w-full" pendingLabel={t("invite.accepting")}>{t("invite.accept")}</SubmitButton>
      </form>
    </AuthShell>
  );
}
