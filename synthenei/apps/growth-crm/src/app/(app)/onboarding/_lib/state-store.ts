// Onboarding progress storage. This is per-browser UX state (which step you're on), not business data -- every real
// mutation a step makes (saveConfig, inviteMember, ...) re-checks its own permission server-side regardless of what
// this cookie says, so a tampered or stale cookie can show the wrong wizard step but never skip a real permission
// check. One cookie per tenant (`onboarding_<tenantId>`) so a platform admin moving between tenants in support mode,
// or a user who owns more than one org, does not mix up two orgs' progress.
import "server-only";
import { cookies } from "next/headers";
import { cookieOpts } from "@/lib/auth/cookies";
import { emptyState, parseState } from "./progress";
import type { OnboardingState } from "./types";

const NAME = (tenantId: string) => `onboarding_${tenantId}`;
const MAX_AGE = 60 * 60 * 24 * 90; // 90 days: long enough to resume setup started on day one, weeks later

export async function loadOnboardingState(tenantId: string): Promise<OnboardingState> {
  const raw = (await cookies()).get(NAME(tenantId))?.value;
  if (!raw) return emptyState();
  try { return parseState(JSON.parse(raw)); } catch { return emptyState(); }
}
export async function saveOnboardingState(tenantId: string, state: OnboardingState): Promise<void> {
  (await cookies()).set(NAME(tenantId), JSON.stringify(state), cookieOpts(MAX_AGE));
}
