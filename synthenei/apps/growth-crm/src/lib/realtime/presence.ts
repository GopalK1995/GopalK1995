import { PRESENCE_COLORS, type ChangePayload, type EditingState, type Identity, type PresenceColor, type PresenceUser } from "./types";

function hash(s: string): number { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
export function colorFor(userId: string): PresenceColor { return PRESENCE_COLORS[hash(userId) % PRESENCE_COLORS.length]; }
export function initialsOf(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "?") + (p.length > 1 ? (p[p.length - 1][0] ?? "") : "")).toUpperCase();
}

/** What we publish about ourselves: display name, initials, colour token, join time. No email, role, ip, or record data. */
export function presencePayload(me: Identity, now: number): Omit<PresenceUser, "sample"> {
  const name = me.name.slice(0, 80);
  return { userId: me.id, name, initials: initialsOf(name), color: colorFor(me.id), at: now };
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Whitelist a peer's presence entry. Unknown keys are dropped, so a peer cannot smuggle anything into our UI. */
export function sanitizePresence(raw: unknown): PresenceUser | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.userId !== "string" || !ID.test(r.userId) || typeof r.name !== "string") return null;
  const name = r.name.slice(0, 80);
  return {
    userId: r.userId, name, initials: initialsOf(name),
    color: PRESENCE_COLORS.includes(r.color as PresenceColor) ? (r.color as PresenceColor) : colorFor(r.userId),
    at: typeof r.at === "number" && Number.isFinite(r.at) ? r.at : 0,
  };
}

/** presenceState() groups entries by presence key (user id). One face per user even with several tabs; earliest join wins. */
export function usersFromState(state: Record<string, unknown[]>): PresenceUser[] {
  const by = new Map<string, PresenceUser>();
  for (const entries of Object.values(state)) for (const e of entries) {
    const u = sanitizePresence(e);
    if (u && (!by.has(u.userId) || u.at < (by.get(u.userId)?.at ?? Infinity))) by.set(u.userId, u);
  }
  return [...by.values()].sort((a, b) => a.at - b.at || a.userId.localeCompare(b.userId));
}

/** `field: ""` means the peer stopped editing. */
export function parseEditing(raw: unknown): EditingState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.userId !== "string" || !ID.test(r.userId)) return null;
  if (r.field !== null && (typeof r.field !== "string" || (r.field !== "" && !ID.test(r.field)))) return null;
  return { userId: r.userId, field: (r.field as string | null) ?? "" };
}

/** Keep only the five id-only keys. Anything else a buggy sender adds is ignored; row data is never read from a payload. */
export function parseChange(raw: unknown): ChangePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !ID.test(r.id)) return null;
  if (r.op !== "INSERT" && r.op !== "UPDATE" && r.op !== "DELETE") return null;
  return {
    id: r.id, op: r.op,
    version: typeof r.version === "number" ? r.version : null,
    changedBy: typeof r.changed_by === "string" ? r.changed_by : null,
    changedFields: Array.isArray(r.changed_fields) ? r.changed_fields.filter((f): f is string => typeof f === "string").slice(0, 30) : [],
  };
}
