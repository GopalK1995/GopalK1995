// Field-level conflict detection for conflict-safe editing. base = the record as you opened it, theirs = the current row
// (a colleague saved), mine = your unsaved draft. Pure functions; the version column decides whether a conflict exists.
export type Fields = Record<string, unknown>;
export interface FieldDiff { field: string; base: unknown; mine: unknown; theirs: unknown; kind: "conflict" | "theirs-only" | "mine-only" }
export type Choice = "mine" | "theirs";

const IGNORED = new Set(["id", "version", "updatedAt", "updated_at", "createdAt", "created_at", "workspaceId", "tenantId"]);

export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a == null && b == null) return true;
  if (typeof a === "object" && typeof b === "object" && a && b) return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

export function diffFields(base: Fields, mine: Fields, theirs: Fields): FieldDiff[] {
  const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
  const out: FieldDiff[] = [];
  for (const field of [...keys].sort()) {
    if (IGNORED.has(field)) continue;
    const myChange = field in mine && !sameValue(mine[field], base[field]);
    const theirChange = !sameValue(theirs[field], base[field]);
    if (!myChange && !theirChange) continue;
    if (myChange && theirChange && sameValue(mine[field], theirs[field])) continue; // both made the same edit
    out.push({ field, base: base[field], mine: mine[field], theirs: theirs[field], kind: myChange && theirChange ? "conflict" : theirChange ? "theirs-only" : "mine-only" });
  }
  return out;
}

export interface Conflict { theirs: Fields; diffs: FieldDiff[]; theirsVersion: number; changedBy: string | null }

/** A conflict exists when the current row moved past your base version and you have a draft that differs. Null otherwise. */
export function detectConflict(base: Fields & { version?: number }, mine: Fields | null, theirs: Fields & { version?: number }, changedBy: string | null = null): Conflict | null {
  if (!mine) return null;
  const bv = base.version ?? 0, tv = theirs.version ?? 0;
  if (tv <= bv) return null;
  const diffs = diffFields(base, mine, theirs);
  if (!diffs.some((d) => d.kind === "conflict" || d.kind === "mine-only")) return null; // nothing of yours is at risk
  return { theirs, diffs, theirsVersion: tv, changedBy };
}

/** Build the merged draft on top of their row. Conflicting fields follow `choices` (default: keep theirs); your own-only edits are kept. */
export function mergeDraft(c: Conflict, choices: Record<string, Choice> = {}): Fields {
  const out: Fields = { ...c.theirs };
  for (const d of c.diffs) {
    if (d.kind === "mine-only" || (d.kind === "conflict" && choices[d.field] === "mine")) out[d.field] = d.mine;
  }
  return out;
}

/** Fields you still need to save after merging: those where the merged value differs from their row. Send these with expected_version = theirsVersion. */
export function mergedPatch(c: Conflict, choices: Record<string, Choice> = {}): Fields {
  const merged = mergeDraft(c, choices), patch: Fields = {};
  for (const k of Object.keys(merged)) if (!IGNORED.has(k) && !sameValue(merged[k], c.theirs[k])) patch[k] = merged[k];
  return patch;
}
