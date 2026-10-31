// Client-safe unread badge helpers (repo.ts pulls in server-only code).
/** Max rows the unread query fetches; at or above this the badge shows "99+". */
export const UNREAD_CAP = 100;
export const badgeLabel = (n: number) => (n <= 0 ? "" : n >= UNREAD_CAP ? "99+" : String(n));
