// Server wiring: real Supabase store, process env, system clock, audit through the request client (signed-in actor) or the service client (webhook).
import "server-only";
import type { Principal } from "@/lib/authz/types";
import { actorFromPrincipal, audit, platformActor } from "@/lib/audit/record";
import type { AuditActor } from "@/lib/audit/types";
import { serviceDb } from "@/lib/db/service";
import { snapshot, type AuditLine, type Deps } from "./service";
import { applyBilling, type OrgState, type SeatStatus } from "./state";
import { supabaseBillingStore } from "./store-supabase";
import { memoryBillingStore } from "./memory-store";
import type { BillingStore } from "./store";

let demoStore: BillingStore | null = null;
/** Demo sessions get a per-process in-memory store, never Supabase. */
export const storeFor = (demo: boolean): BillingStore => (demo ? (demoStore ??= memoryBillingStore()) : supabaseBillingStore());

type Who = { kind: "principal"; principal: Principal; demo?: boolean } | { kind: "platform"; uid: string; demo?: boolean } | { kind: "system" };
function auditFor(who: Who): Deps["audit"] {
  return async (l: AuditLine) => {
    const input = { action: l.action, summary: l.summary, detail: l.detail, object: l.object };
    if (who.kind === "system") {
      const actor: AuditActor = { uid: "system", kind: "system", workspaceId: null, source: "job", impersonation: false };
      try { await audit(actor, input, async () => serviceDb()); } catch (e) { console.error("[billing] system audit failed", (e as Error).message); }
      return;
    }
    const actor = who.kind === "principal" ? { ...actorFromPrincipal(who.principal), demo: who.demo } : { ...platformActor(who.uid), demo: who.demo };
    await audit(actor, input);   // a failed audit write fails the action: nothing happens unaudited
  };
}
export function billingDeps(who: Who, demo = false): Deps {
  return { store: storeFor(demo), env: process.env, now: () => new Date(), audit: auditFor(who) };
}

const TTL_MS = 10_000;
type Folded = { org: OrgState; seats: SeatStatus };
const cache = new Map<string, { at: number; v: Folded | null }>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Drop the short-lived cache after a change that moves state (invite, plan, status) so the next request sees it. */
export const invalidateBilling = (tenantId: string) => { cache.delete(tenantId); };

/**
 * Called by loadPrincipal for real sessions: folds trial expiry, subscription state and the seat cap into the principal so authz steps 2 and 3
 * enforce them everywhere. State is cached for 10 s per tenant. An infrastructure failure (billing tables unreadable) leaves the principal as it was:
 * suspension from my_grants still applies, and a billing outage never locks every customer out.
 */
export async function withBilling(p: Principal): Promise<Principal> {
  if (!p.tenantId || !UUID.test(p.tenantId) || p.kind === "platform_admin") return p;
  try {
    let hit = cache.get(p.tenantId);
    if (!hit || Date.now() - hit.at > TTL_MS) {
      const s = await snapshot(billingDeps({ kind: "system" }), p.tenantId);
      hit = { at: Date.now(), v: s ? { org: s.org, seats: s.seats } : null };
      cache.set(p.tenantId, hit);
    }
    return hit.v ? applyBilling(p, hit.v) : p;
  } catch (e) {
    console.error("[billing] enforcement lookup failed; principal unchanged", (e as Error).message);
    return p;
  }
}
