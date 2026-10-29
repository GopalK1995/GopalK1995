// Real-mode persistence for account and contact actions. Pure over injected repositories (unit-testable with the mocked
// client). Authorization (assertCan) happens in the action files BEFORE any of these run; audit rows and
// account.* / contact.* events come from DB triggers (0014).
import { failResult, okResult, type ActionResult } from "@/lib/actions/result";
import { DbError } from "@/lib/db/errors";
import type { Page } from "@/lib/db/page";
import type { Account, AccountInput, Contact, ContactInput } from "@/lib/db/repo/types";
import type { Filter, ListQuery } from "@/lib/db/repo/base";
import type { CreateAccountInput, CreateContactInput } from "./schemas";

export interface Repos {
  accounts: {
    list(ws: string, q?: ListQuery): Promise<Page<Account>>;
    get(ws: string, id: string): Promise<Account | null>;
    create(ws: string, input: AccountInput): Promise<Account>;
    update(ws: string, id: string, v: number, patch: Partial<AccountInput> & Record<string, unknown>): Promise<Account>;
    softDelete(ws: string, id: string, v: number): Promise<void>;
  };
  contacts: {
    list(ws: string, q?: ListQuery): Promise<Page<Contact>>;
    get(ws: string, id: string): Promise<Contact | null>;
    create(ws: string, input: ContactInput): Promise<Contact>;
    update(ws: string, id: string, v: number, patch: Partial<ContactInput> & Record<string, unknown>): Promise<Contact>;
    softDelete(ws: string, id: string, v: number): Promise<void>;
  };
}
export interface Ctx { ws: string; uid: string; repos: Repos }

/** ilike pattern for a literal value (escapes the wildcard characters). */
export const literal = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Existing live account with the same name + city (case-insensitive, blank city = blank city), as the unique index does. */
export async function findDuplicateAccount(c: Ctx, name: string, city: string | null | undefined, exceptId?: string): Promise<Account | null> {
  const filters: Filter[] = [{ field: "name", op: "ilike", value: literal(name.trim()) }];
  filters.push(city ? { field: "city", op: "ilike", value: literal(city.trim()) } : { field: "city", op: "is", value: null });
  const page = await c.repos.accounts.list(c.ws, { limit: 5, filters });
  return page.rows.find((r) => r.id !== exceptId) ?? null;
}

export interface AccountMsgs { created: string; saved: string; assigned: string; deleted: string; duplicate: (name: string, where: string) => string }
const where = (city: string | null | undefined) => (city ? ` in ${city}` : "");
const dupFail = <T>(msg: AccountMsgs, name: string, city: string | null | undefined, id: string) =>
  failResult<T>("invalid", msg.duplicate(name, where(city)), { issues: [{ path: "name", message: msg.duplicate(name, where(city)) }], current: { duplicateOf: id } });

export async function createAccount(c: Ctx, i: CreateAccountInput, msg: AccountMsgs): Promise<ActionResult<{ id: string }>> {
  const dup = await findDuplicateAccount(c, i.name, i.city);
  if (dup) return dupFail(msg, i.name, i.city, dup.id);
  const row = await c.repos.accounts.create(c.ws, {
    name: i.name, city: i.city || null, district: i.district || null, website: i.website || null,
    lawyersCount: i.lawyersCount ?? null, ownerId: i.ownerId ?? c.uid,
  } as AccountInput);
  return okResult(msg.created, { data: { id: row.id } });
}

export async function updateAccount(c: Ctx, cur: Account, expectedVersion: number, patch: Record<string, unknown>, msg: AccountMsgs): Promise<ActionResult<{ version: number }>> {
  const name = typeof patch.name === "string" ? patch.name : cur.name;
  const city = typeof patch.city === "string" ? patch.city : cur.city;
  if ("name" in patch || "city" in patch) {
    const dup = await findDuplicateAccount(c, name, city, cur.id);
    if (dup) return dupFail(msg, name, city, dup.id);
  }
  const body = { ...patch, ...("city" in patch ? { city: (patch.city as string) || null } : {}), ...("district" in patch ? { district: (patch.district as string) || null } : {}), ...("website" in patch ? { website: (patch.website as string) || null } : {}) };
  const row = await c.repos.accounts.update(c.ws, cur.id, expectedVersion, body as Partial<AccountInput>);
  return okResult(msg.saved, { data: { version: row.version } });
}

export async function assignAccount(c: Ctx, id: string, expectedVersion: number, ownerId: string | null, msg: AccountMsgs): Promise<ActionResult<{ version: number }>> {
  const row = await c.repos.accounts.update(c.ws, id, expectedVersion, { ownerId } as Partial<AccountInput>);
  return okResult(msg.assigned, { data: { version: row.version } });
}

/** All live contacts of an account (pages of 100). */
export async function contactsOf(c: Ctx, accountId: string, cap = 1000): Promise<Contact[]> {
  const out: Contact[] = [];
  let cursor: string | undefined;
  do {
    const p = await c.repos.contacts.list(c.ws, { limit: 100, cursor, filters: [{ field: "accountId", op: "eq", value: accountId }] });
    out.push(...p.rows);
    cursor = p.nextCursor ?? undefined;
  } while (cursor && out.length < cap);
  return out;
}

/** Soft-delete rule: an account with live contacts cannot be removed. Merge or move them first. */
export async function deleteAccount(c: Ctx, id: string, expectedVersion: number, msg: { deleted: string; blocked: (n: number) => string }): Promise<ActionResult> {
  const linked = await c.repos.contacts.list(c.ws, { limit: 100, filters: [{ field: "accountId", op: "eq", value: id }] });
  if (linked.rows.length > 0) {
    const n = linked.rows.length;
    return failResult("invalid", msg.blocked(n), { current: { linkedContacts: n } });
  }
  await c.repos.accounts.softDelete(c.ws, id, expectedVersion);
  return okResult(msg.deleted);
}

/**
 * Merge `source` into `target`: contacts are re-linked one by one (each with its own version check), then the source is
 * soft-deleted at the version the caller rendered. Not atomic across rows; a failure part-way leaves some contacts moved
 * (re-running the merge finishes it). A DB RPC `merge_accounts` would make it atomic (listed under Needs from integrator).
 */
export async function mergeAccounts(c: Ctx, sourceId: string, targetId: string, v: { source: number; target: number }, msg: { merged: (n: number) => string; same: string }): Promise<ActionResult<{ moved: number }>> {
  if (sourceId === targetId) return failResult("invalid", msg.same);
  const tgt = await c.repos.accounts.get(c.ws, targetId);
  if (!tgt) throw new DbError("not_found", "not_found");
  if (tgt.version !== v.target) throw new DbError("conflict", "conflict", { current: tgt });
  const moved = await contactsOf(c, sourceId);
  for (const ct of moved) await c.repos.contacts.update(c.ws, ct.id, ct.version, { accountId: targetId } as Partial<ContactInput>);
  await c.repos.accounts.softDelete(c.ws, sourceId, v.source);
  return okResult(msg.merged(moved.length), { data: { moved: moved.length } });
}

// ---------- contacts ----------
export interface ContactMsgs { created: string; saved: string; deleted: string; duplicate: (field: string) => string }

export async function findDuplicateContact(c: Ctx, email: string | undefined, phone: string | undefined, exceptId?: string): Promise<{ row: Contact; field: string } | null> {
  const checks: [string, Filter][] = [];
  if (email) checks.push(["email", { field: "email", op: "ilike", value: literal(email) }]);
  if (phone) checks.push(["phone", { field: "phone", op: "eq", value: phone }]);
  for (const [field, f] of checks) {
    const p = await c.repos.contacts.list(c.ws, { limit: 5, filters: [f] });
    const row = p.rows.find((r) => r.id !== exceptId);
    if (row) return { row, field };
  }
  return null;
}
const normPhone = (p: string) => p.replace(/[\s-]/g, "");

export async function createContact(c: Ctx, i: CreateContactInput, msg: ContactMsgs): Promise<ActionResult<{ id: string }>> {
  const dup = await findDuplicateContact(c, i.email || undefined, i.phone ? normPhone(i.phone) : undefined);
  if (dup) return failResult("invalid", msg.duplicate(dup.field), { issues: [{ path: dup.field, message: msg.duplicate(dup.field) }], current: { duplicateOf: dup.row.id } });
  const row = await c.repos.contacts.create(c.ws, {
    fullName: i.fullName, roleTitle: i.roleTitle || null, email: i.email || null, phone: i.phone ? normPhone(i.phone) : null,
    accountId: i.accountId ?? null, isDecisionMaker: i.isDecisionMaker ?? false, ownerId: i.ownerId ?? c.uid,
  } as ContactInput);
  return okResult(msg.created, { data: { id: row.id } });
}

export async function updateContact(c: Ctx, cur: Contact, expectedVersion: number, patch: Record<string, unknown>, msg: ContactMsgs): Promise<ActionResult<{ version: number }>> {
  const email = typeof patch.email === "string" ? patch.email : undefined;
  const phone = typeof patch.phone === "string" ? normPhone(patch.phone) : undefined;
  const dup = await findDuplicateContact(c, email || undefined, phone || undefined, cur.id);
  if (dup) return failResult("invalid", msg.duplicate(dup.field), { issues: [{ path: dup.field, message: msg.duplicate(dup.field) }], current: { duplicateOf: dup.row.id } });
  const body: Record<string, unknown> = { ...patch };
  for (const k of ["roleTitle", "email"]) if (k in body) body[k] = (body[k] as string) || null;
  if ("phone" in body) body.phone = phone || null;
  const row = await c.repos.contacts.update(c.ws, cur.id, expectedVersion, body as Partial<ContactInput>);
  return okResult(msg.saved, { data: { version: row.version } });
}

export async function deleteContact(c: Ctx, id: string, expectedVersion: number, msg: ContactMsgs): Promise<ActionResult> {
  await c.repos.contacts.softDelete(c.ws, id, expectedVersion);
  return okResult(msg.deleted);
}

// ---------- export ----------
const cell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const maskContact = (s: string) => s.replace(/^(.).*?(@.*)?$/, (_, a: string, b?: string) => `${a}***${b ?? ""}`);
export const maskPerson = (n: string) => n.split(" ").filter(Boolean).map((p) => p[0] + ".").join(" ");

export function accountsCsv(rows: Account[], ownerNames: Record<string, string>): string {
  const head = ["account_id", "name", "city", "district", "status", "owner", "website", "created_at"];
  const body = rows.map((a) => [a.id, a.name, a.city, a.district, a.customerStatus, a.ownerId ? ownerNames[a.ownerId] ?? "" : "", a.website, a.createdAt].map(cell).join(","));
  return [head.join(","), ...body].join("\n");
}
/** Contacts carry personal data: masked unless the caller holds pii.read AND chose unmasked. */
export function contactsCsv(rows: Contact[], opts: { mask: boolean; accountNames: Record<string, string> }): string {
  const head = ["contact_id", "name", "role", "account", "decision_maker", "phone", "email", "created_at"];
  const m = opts.mask;
  const body = rows.map((r) => [r.id, m ? maskPerson(r.fullName) : r.fullName, r.roleTitle, r.accountId ? opts.accountNames[r.accountId] ?? "" : "", r.isDecisionMaker ? "yes" : "no", m ? maskContact(r.phone ?? "") : r.phone, m ? maskContact(r.email ?? "") : r.email, r.createdAt].map(cell).join(","));
  return [head.join(","), ...body].join("\n");
}
