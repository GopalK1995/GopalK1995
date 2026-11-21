// Field-level three-way merge with the integration_field_maps rules. Pure and deterministic.
//
// State per link (external_links.content_hash) = what each side held at the last sync, one short hash per column:
//   { l: { column: hash of the CRM value }, r: { column: hash of the vendor value (already mapped to the CRM's column space) } }
// A column is "changed" on a side when its current hash differs from the stored one. Only a column changed on BOTH sides, with
// different values, is a conflict; every other change simply travels in its direction.
//
//   direction  | only vendor changed | only CRM changed | both changed (values differ)
//   in         | pull                | kept locally     | vendor wins
//   out        | ignored             | push             | CRM wins
//   both       | pull                | push             | conflict_owner: crm -> CRM, external -> vendor, last_write -> newer timestamp
//
// last_write compares the CRM row's updated_at with the vendor record's modified time; a tie, or a missing timestamp, goes to the CRM.
import { createHash } from "node:crypto";
import type { FieldMapSpec } from "../../core/types";

export type Owner = "crm" | "external" | "last_write";
export type Winner = "local" | "remote";

export interface ColumnSpec {
  column: string; externalField: string; direction: "in" | "out" | "both"; owner: Owner;
  transform: FieldMapSpec["transform"]; transformArg: FieldMapSpec["transformArg"];
}
export interface Base { l: Record<string, string>; r: Record<string, string> }
export type Decision = "pull" | "push" | "conflict_local" | "conflict_remote";

/** Normal form used to compare values across the two sides (numbers vs numeric strings, padding). */
export function canon(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString();
  const s = typeof v === "string" ? v.trim() : JSON.stringify(v);
  return /^-?\d+(\.\d+)?$/.test(s) && s.length < 16 ? String(Number(s)) : s;
}
export const same = (a: unknown, b: unknown): boolean => canon(a) === canon(b);
export const shortHash = (v: unknown): string => createHash("sha256").update(canon(v)).digest("hex").slice(0, 10);

export function resolveConflict(owner: Owner, direction: ColumnSpec["direction"], localAt: string | null, remoteAt: string | null): Winner {
  if (direction === "in") return "remote";
  if (direction === "out") return "local";
  if (owner === "external") return "remote";
  if (owner === "last_write") {
    const l = localAt ? Date.parse(localAt) : NaN, r = remoteAt ? Date.parse(remoteAt) : NaN;
    return Number.isFinite(l) && Number.isFinite(r) && r > l ? "remote" : "local";
  }
  return "local";
}

export interface ReconcileInput {
  specs: ColumnSpec[];
  /** CRM values by column; a column absent from the object is treated as null. */
  local: Record<string, unknown>;
  /** Vendor values mapped to CRM columns. A column that is absent (not sent, or its transform failed) is unknown and left alone. */
  remote: Record<string, unknown>;
  localAt: string | null; remoteAt: string | null;
  /** null = first meeting of the two records (no link yet): every column counts as changed on both sides. */
  base: Base | null;
  /** Columns that can never be null. */
  required: ReadonlySet<string>;
}
export interface Plan {
  localPatch: Record<string, unknown>; remotePatch: Record<string, unknown>;
  decisions: { column: string; decision: Decision }[];
  /** What each side holds after the patches are applied; store it as the new base. */
  next: Base;
}

export function reconcile(i: ReconcileInput): Plan {
  const plan: Plan = { localPatch: {}, remotePatch: {}, decisions: [], next: { l: { ...(i.base?.l ?? {}) }, r: { ...(i.base?.r ?? {}) } } };
  for (const s of i.specs) {
    const c = s.column;
    if (!(c in i.remote)) { if (c in i.local) plan.next.l[c] = shortHash(i.local[c]); continue; }   // unknown on the vendor side
    const lv = i.local[c] ?? null, rv = i.remote[c] ?? null;
    const nullBlocked = i.required.has(c) && (lv === null || rv === null);
    if (nullBlocked) continue;                                  // never write or push a null into a required column
    const lh = shortHash(lv), rh = shortHash(rv);
    const lChanged = i.base ? i.base.l[c] !== lh : true, rChanged = i.base ? i.base.r[c] !== rh : true;
    if (same(lv, rv)) { plan.next.l[c] = lh; plan.next.r[c] = rh; continue; }
    const canPull = s.direction !== "out", canPush = s.direction !== "in";
    let toLocal = false, toRemote = false;
    if (rChanged && !lChanged) { if (canPull) { toLocal = true; plan.decisions.push({ column: c, decision: "pull" }); } }
    else if (lChanged && !rChanged) { if (canPush) { toRemote = true; plan.decisions.push({ column: c, decision: "push" }); } }
    else if (lChanged && rChanged) {
      const w = resolveConflict(s.owner, s.direction, i.localAt, i.remoteAt);
      if (w === "remote") { toLocal = true; plan.decisions.push({ column: c, decision: "conflict_remote" }); }
      else { toRemote = true; plan.decisions.push({ column: c, decision: "conflict_local" }); }
    }
    if (toLocal) plan.localPatch[c] = rv;
    if (toRemote) plan.remotePatch[c] = lv;
    plan.next.l[c] = shortHash(toLocal ? rv : lv);
    plan.next.r[c] = shortHash(toRemote ? lv : rv);
  }
  return plan;
}

export const encodeBase = (b: Base): string => JSON.stringify(b);
export function decodeBase(s: string | null | undefined): Base | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s) as { l?: unknown; r?: unknown };
    const ok = (x: unknown): x is Record<string, string> => !!x && typeof x === "object" && !Array.isArray(x) && Object.values(x as object).every((y) => typeof y === "string");
    return ok(v.l) && ok(v.r) ? { l: v.l, r: v.r } : null;   // a hash written by the generic upserter (plain hex) is not a base: first-meeting rules apply
  } catch { return null; }
}

/** Owner of a column from the effective field map: the DB default is crm. */
export const ownerOf = (f: Pick<FieldMapSpec, "conflictOwner">): Owner => f.conflictOwner ?? "crm";
