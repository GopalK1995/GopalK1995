// Validation and escalation rules for creating a key. Pure, so the server action and the unit tests share them.
// A key is a user with a role plus scopes: the role must not exceed the creator's, and every scope must be usable by the creator.
import { z } from "zod";
import { decide } from "@/lib/authz/engine";
import type { Principal } from "@/lib/authz/types";
import { ROLES } from "@/lib/auth/roles";
import { invalidScopes, normalizeScopes, permissionsForScopes, SCOPE_RESOURCES } from "@/lib/api/scopes";
import { checkRoleAssignment, type Actor } from "../../roles/_lib/guards";

export const createKeySchema = z.object({
  name: z.string().trim().min(2).max(80),
  env: z.enum(["live", "test"]),
  role: z.enum(ROLES as [string, ...string[]]),
  scopes: z.array(z.string()).min(1).max(30),
  expiresInDays: z.number().int().min(1).max(365).nullable(),
}).strict();
export type CreateKeyInput = z.infer<typeof createKeySchema>;

export type Escalation = { ok: true; scopes: string[] } | { ok: false; code: "unknown_scope" | "role_exceeds_you" | "scope_not_held"; scopes?: string[] };

export function checkKeyEscalation(actor: Actor, principal: Principal, input: Pick<CreateKeyInput, "role" | "scopes">): Escalation {
  const scopes = normalizeScopes(input.scopes);
  const bad = invalidScopes(scopes);
  if (bad.length) return { ok: false, code: "unknown_scope", scopes: bad };
  const role = checkRoleAssignment(actor, { baseRole: input.role as Actor["baseRole"], custom: false });
  if (!role.ok) return { ok: false, code: "role_exceeds_you" };
  // A scope the creator could not use at all (for example webhooks:write without webhooks.manage) must not be handed out.
  const notHeld = scopes.filter((s) => {
    const [res] = s.split(":");
    if (res === "records") return false; // custom objects: object permissions are enforced per object at request time
    if (!(SCOPE_RESOURCES as readonly string[]).includes(res)) return true;
    const perms = permissionsForScopes([s]);
    return !perms.some((p) => decide(principal, p).allow);
  });
  if (notHeld.length) return { ok: false, code: "scope_not_held", scopes: notHeld };
  return { ok: true, scopes };
}

export const expiryFrom = (days: number | null, now = Date.now()): string | null => (days === null ? null : new Date(now + days * 86_400_000).toISOString());
