import { acceptInvite } from "@/lib/auth/actions";
import { safeNext } from "@/lib/auth/cookies";
import { Button } from "@/components/ui/button";
import { AuthAlert, AuthShell } from "../_shell";

export const metadata = { title: "Accept invitation" };

/** The emailed link opens here. The token is only spent when the person presses the button, so mail scanners cannot use it up. */
export default async function AcceptInvite({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string; next?: string }> }) {
  const sp = await searchParams;
  if (!sp.token_hash) return <AuthShell title="Invitation link"><AuthAlert>This invitation link is incomplete. Ask your admin to send a new one.</AuthAlert></AuthShell>;
  return (
    <AuthShell title="You have been invited" lead="Accept the invitation, then choose a password to enter your workspace.">
      <form action={acceptInvite} className="space-y-3">
        <input type="hidden" name="token_hash" value={sp.token_hash} />
        <input type="hidden" name="type" value={sp.type === "recovery" ? "recovery" : "invite"} />
        <input type="hidden" name="next" value={safeNext(sp.next) ?? ""} />
        <Button variant="primary" size="lg" className="w-full">Accept invitation</Button>
      </form>
    </AuthShell>
  );
}
