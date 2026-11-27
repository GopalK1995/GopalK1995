// Who may hand out which system role (AUD-115). One constant for the UI, the server guards and the parity test.
// SQL twin: public.guard_membership_change (0013) lets a sales_manager insert, change or delete memberships only when the old
// and the new role are sales_rep or viewer, and authz.role_within_caller blocks any role holding more than the caller.
// __tests__/sql-parity.test.ts pins this list to both: the literal in the 0013 guard and "every grant is held at >= scope".
export type BaseRole = "owner" | "sales_manager" | "sales_rep" | "marketing" | "data" | "viewer";
/** System roles a Sales Manager may assign or revoke: strictly below the manager (a subset of the manager's own grants). */
export const MANAGER_SCOPE: readonly BaseRole[] = ["sales_rep", "viewer"];
