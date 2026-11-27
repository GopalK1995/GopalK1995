// The MFA gate used by every live sign-in path (AUD-029). Takes a Supabase-like client so it can be unit tested without a network.
// Fails SAFE for the user, not open: a policy lookup error means the default policy applies (privileged roles need MFA), and a
// privileged user with no factor is always routed to enrolment, so the rollout can never strand the owner on a dead end.
import type { Role } from "../data/types";
import { mfaStep } from "./session";
import { DEFAULT_MFA_POLICY, mfaRequirement, parseMfaPolicy, type TenantMfaPolicy } from "./mfa-policy";

type Row = { tenant_id: string; role: Role; via_support_session?: boolean | null };
export interface GateClient {
  rpc(fn: "my_workspaces"): PromiseLike<{ data: unknown }>;
  from(t: "tenant_config"): { select(cols: string): { in(col: string, v: string[]): PromiseLike<{ data: unknown }> } };
  auth: { mfa: {
    getAuthenticatorAssuranceLevel(): PromiseLike<{ data: { currentLevel?: string | null; nextLevel?: string | null } | null }>;
    listFactors(): PromiseLike<{ data: { totp?: { status: string }[] } | null }>;
  } };
}

/** Per-membership tenant policy, read with the user's own client (members can read their tenant_config under RLS). */
async function policyRows(sb: GateClient, now: number) {
  const { data } = await sb.rpc("my_workspaces");
  const rows = ((data as Row[] | null) ?? []).filter((r) => !r.via_support_session && r.tenant_id && r.role);
  const ids = [...new Set(rows.map((r) => r.tenant_id))];
  const policies = new Map<string, TenantMfaPolicy>();
  if (ids.length) {
    try {
      const { data: cfg } = await sb.from("tenant_config").select("tenant_id, config").in("tenant_id", ids);
      for (const c of (cfg as { tenant_id: string; config: unknown }[] | null) ?? []) policies.set(c.tenant_id, parseMfaPolicy(c.config, now));
    } catch { /* default policy applies */ }
  }
  return rows.map((r) => ({ role: r.role, policy: policies.get(r.tenant_id) ?? DEFAULT_MFA_POLICY }));
}

export async function mfaGate(sb: GateClient, platformAdmin: boolean, now = Date.now()): Promise<"none" | "challenge" | "enrol"> {
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  const { data: f } = await sb.auth.mfa.listFactors();
  const hasVerifiedTotp = !!f?.totp?.some((x) => x.status === "verified");
  if (aal?.currentLevel === "aal2") return "none";
  const req = platformAdmin ? { required: true, graceActive: false } : mfaRequirement(await policyRows(sb, now), now);
  return mfaStep({ current: aal?.currentLevel, next: aal?.nextLevel }, { platformAdmin, hasVerifiedTotp, ...req });
}
