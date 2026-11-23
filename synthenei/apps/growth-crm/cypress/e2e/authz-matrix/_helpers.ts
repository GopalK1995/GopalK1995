// Shared by the authz-matrix channel specs (T057). The expected allow/deny for every cell comes from the SAME fixture
// the TS engine and the SQL pgTAP suite use: src/lib/authz/__fixtures__/matrix.json. So the UI and API channels assert
// against exactly the decisions supabase/tests/authz_matrix.test.sql checks the SQL evaluator against.
import matrix from "../../../src/lib/authz/__fixtures__/matrix.json";

type Row = [string, string, string, string, string, string, boolean, string | null, number];
const rows = matrix.rows as Row[];

/** Demo-persona button ids keyed by system role (see cypress/support/personas.ts). manager and data have no demo persona. */
export const PERSONA_FOR: Partial<Record<string, string>> = {
  owner: "owner-lawsome", sales_rep: "rep-lawsome", marketing: "mkt-lawsome", viewer: "viewer-lawsome",
};

/** Decision for (role, permission) at list level: support none, active tenant, no modules off, no record. */
export function listAllow(role: string, perm: string): boolean {
  const r = rows.find((x) => x[0] === role && x[1] === "none" && x[2] === "active" && x[3] === "" && x[4] === perm && x[5] === "none");
  if (!r) throw new Error(`no matrix cell for ${role} ${perm} (list level)`);
  return r[6];
}

/** Decision for (role, permission) against an owned record: support none, active, record = own. */
export function ownAllow(role: string, perm: string): boolean {
  const r = rows.find((x) => x[0] === role && x[1] === "none" && x[2] === "active" && x[3] === "" && x[4] === perm && x[5] === "own");
  if (!r) throw new Error(`no matrix cell for ${role} ${perm} (own record)`);
  return r[6];
}
