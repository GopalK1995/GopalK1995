// Org-admin policy: what an org admin may configure. Pure helpers (validation + diff) shared by the editor and the action.
import { MODULE_IDS } from "@/lib/config/types";
import type { OrgPolicy } from "./repo";

export const POLICY_BOOLS = ["allow_custom_roles", "allow_custom_objects", "allow_api_keys", "allow_webhooks", "allow_byok"] as const;
export const POLICY_NUMS = ["max_seats", "max_workspaces", "max_custom_fields"] as const;
export const POLICY_LISTS = ["allow_connectors", "allowed_modules"] as const;
export type PolicyPatch = Partial<Record<(typeof POLICY_BOOLS)[number], boolean> & Record<(typeof POLICY_NUMS)[number], number | null> & Record<(typeof POLICY_LISTS)[number], string[] | null>>;

export const MODULE_CHOICES: readonly string[] = MODULE_IDS;

const CAMEL: Record<string, keyof OrgPolicy> = {
  allow_custom_roles: "allowCustomRoles", allow_custom_objects: "allowCustomObjects", allow_api_keys: "allowApiKeys", allow_webhooks: "allowWebhooks", allow_byok: "allowByok",
  max_seats: "maxSeats", max_workspaces: "maxWorkspaces", max_custom_fields: "maxCustomFields", allow_connectors: "allowConnectors", allowed_modules: "allowedModules",
};

export type PolicyCheck = { ok: true; patch: PolicyPatch } | { ok: false; field: string; code: "badNumber" | "badList" | "unknownKey" | "badType"; ids?: string[] };

/** Validates an untrusted patch. Unknown keys are rejected (never forwarded to the RPC). */
export function checkPolicyPatch(input: unknown, knownConnectors: readonly string[]): PolicyCheck {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, field: "", code: "badType" };
  const patch: PolicyPatch = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if ((POLICY_BOOLS as readonly string[]).includes(k)) {
      if (typeof v !== "boolean") return { ok: false, field: k, code: "badType" };
      (patch as Record<string, unknown>)[k] = v;
    } else if ((POLICY_NUMS as readonly string[]).includes(k)) {
      if (v !== null && !(typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1_000_000)) return { ok: false, field: k, code: "badNumber" };
      (patch as Record<string, unknown>)[k] = v;
    } else if ((POLICY_LISTS as readonly string[]).includes(k)) {
      if (v !== null && !(Array.isArray(v) && v.every((x) => typeof x === "string"))) return { ok: false, field: k, code: "badList" };
      const allowed = k === "allowed_modules" ? MODULE_CHOICES : knownConnectors;
      const list = v === null ? null : [...new Set(v as string[])];
      if (list && list.some((x) => !allowed.includes(x))) return { ok: false, field: k, code: "badList", ids: [...allowed] };
      (patch as Record<string, unknown>)[k] = list;
    } else return { ok: false, field: k, code: "unknownKey" };
  }
  return { ok: true, patch };
}

const same = (a: unknown, b: unknown) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].sort() : b);
/** Keeps only the keys whose value differs from the current policy. */
export function diffPolicy(current: OrgPolicy, patch: PolicyPatch): PolicyPatch {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (!same(current[CAMEL[k]], v)) out[k] = v;
  return out as PolicyPatch;
}
