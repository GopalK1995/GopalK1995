import { describe, expect, it } from "vitest";
import { createAccountsRepo } from "@/lib/db/repo/accounts";
import { createContactsRepo } from "@/lib/db/repo/contacts";
import { runAction } from "@/lib/actions/result";
import { err, has, mockDb, ok } from "@/lib/db/__tests__/mock";
import type { Account, Contact } from "@/lib/db/repo/types";
import { vocabFor } from "@/lib/vertical";
import * as P from "../persist";
import { assignAccountSchema, createAccountSchema, createContactSchema, mergeSchema, updateAccountSchema, updateContactSchema } from "../schemas";
import { at } from "../strings";

const WS = "11111111-1111-4111-8111-111111111111";
const UID = "22222222-2222-4222-8222-222222222222";
const acc = { id: "A1", name: "Rao & Co", city: "Madurai", ownerId: UID, version: 3, customerStatus: "prospect", createdAt: "2026-10-01" } as unknown as Account;
const con = { id: "C1", fullName: "Asha Rao", phone: "9876543210", email: "asha@firm.in", roleTitle: "Partner", accountId: "A1", isDecisionMaker: true, ownerId: UID, version: 2, createdAt: "2026-10-02" } as unknown as Contact;
const list = (rows: unknown[]) => ok(rows);
const mk = (results: Parameters<typeof mockDb>[0]) => {
  const { db, calls } = mockDb(results);
  const g = () => Promise.resolve(db);
  const c: P.Ctx = { ws: WS, uid: UID, repos: { accounts: createAccountsRepo(g), contacts: createContactsRepo(g) } };
  return { c, calls };
};
const am: P.AccountMsgs = { created: "Added", saved: "Saved", assigned: "Reassigned", deleted: "Removed", duplicate: (n, w) => `${n} exists${w}` };
const cm: P.ContactMsgs = { created: "Contact added", saved: "Contact saved", deleted: "Contact removed", duplicate: (f) => `dup ${f}` };

describe("schemas", () => {
  it("account create needs a name; update needs version and a field", () => {
    expect(createAccountSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createAccountSchema.safeParse({ name: "Rao & Co", city: "Madurai" }).success).toBe(true);
    expect(updateAccountSchema.safeParse({ expectedVersion: 1, patch: {} }).success).toBe(false);
    expect(updateAccountSchema.safeParse({ patch: { city: "x" } }).success).toBe(false);
    expect(updateAccountSchema.safeParse({ expectedVersion: 1, patch: { customerStatus: "won" } }).success).toBe(false);
    expect(assignAccountSchema.safeParse({ expectedVersion: 1, ownerId: null }).success).toBe(true);
    expect(mergeSchema.safeParse({ targetId: "A2", sourceVersion: 1 }).success).toBe(false);
  });
  it("contact validates phone and email", () => {
    expect(createContactSchema.safeParse({ fullName: "A", phone: "123" }).success).toBe(false);
    expect(createContactSchema.safeParse({ fullName: "A", email: "nope" }).success).toBe(false);
    expect(createContactSchema.safeParse({ fullName: "A", phone: "98765 43210" }).success).toBe(true);
    expect(updateContactSchema.safeParse({ expectedVersion: 2, patch: {} }).success).toBe(false);
  });
});

describe("accounts", () => {
  it("create runs dedupe (name + city) first and refuses a duplicate without inserting", async () => {
    const { c, calls } = mk([list([acc])]);
    const r = await P.createAccount(c, createAccountSchema.parse({ name: "rao & co", city: "madurai" }), am);
    expect(r).toMatchObject({ ok: false, code: "invalid", current: { duplicateOf: "A1" } });
    expect(calls.map((x) => x.table)).toEqual(["accounts"]);
    expect(has(calls[0], "ilike", "name", "rao & co")).toBe(true);
    expect(calls[0].ops.some(([o]) => o === "insert")).toBe(false);
  });
  it("create without a city dedupes against blank city and inserts with the caller as owner", async () => {
    const { c, calls } = mk([list([]), ok({ ...acc, id: "NEW" })]);
    const r = await P.createAccount(c, createAccountSchema.parse({ name: "New Co" }), am);
    expect(r).toMatchObject({ ok: true, data: { id: "NEW" } });
    expect(has(calls[0], "is", "city", null)).toBe(true);
    const ins = calls[1].ops.find(([o]) => o === "insert")![1][0] as Record<string, unknown>;
    expect(ins).toMatchObject({ name: "New Co", owner_id: UID, workspace_id: WS });
  });
  it("update is version guarded; renaming into an existing name is refused", async () => {
    const a = mk([ok([{ ...acc, version: 4 }])]);
    expect(await P.updateAccount(a.c, acc, 3, { website: "x.in" }, am)).toMatchObject({ ok: true, data: { version: 4 } });
    expect(has(a.calls[0], "eq", "version", 3)).toBe(true);
    const b = mk([list([{ ...acc, id: "OTHER" }])]);
    expect(await P.updateAccount(b.c, acc, 3, { name: "Taken" }, am)).toMatchObject({ ok: false, code: "invalid" });
  });
  it("a stale version becomes a conflict carrying only what the UI needs", async () => {
    const { c } = mk([ok([]), ok({ ...acc, version: 9 })]);
    const r = await runAction(() => P.assignAccount(c, "A1", 3, UID, am));
    expect(r).toMatchObject({ ok: false, code: "conflict", current: { version: 9 } });
  });
  it("RLS denial surfaces as denied", async () => {
    const { c } = mk([err("42501")]);
    expect(await runAction(() => P.assignAccount(c, "A1", 3, UID, am))).toMatchObject({ ok: false, code: "denied" });
  });
  it("delete is blocked while live contacts are linked, otherwise soft-deletes", async () => {
    const blocked = mk([list([con])]);
    expect(await P.deleteAccount(blocked.c, "A1", 3, { deleted: "x", blocked: (n) => `${n} linked` })).toMatchObject({ ok: false, message: "1 linked" });
    expect(blocked.calls.length).toBe(1);
    const free = mk([list([]), ok([{ ...acc, deletedAt: "now" }])]);
    expect((await P.deleteAccount(free.c, "A1", 3, { deleted: "x", blocked: String })).ok).toBe(true);
    const upd = free.calls[1].ops.find(([o]) => o === "update")![1][0] as Record<string, unknown>;
    expect(typeof upd.deleted_at).toBe("string");
  });
  it("merge re-links every contact then soft-deletes the source; checks the target version first", async () => {
    const { c, calls } = mk([ok({ ...acc, id: "A2", version: 5 }), list([con]), ok([{ ...con, version: 3 }]), ok([{ ...acc, version: 4 }])]);
    const r = await P.mergeAccounts(c, "A1", "A2", { source: 3, target: 5 }, { merged: (n) => `moved ${n}`, same: "same" });
    expect(r).toMatchObject({ ok: true, message: "moved 1", data: { moved: 1 } });
    expect(calls.map((x) => x.table)).toEqual(["accounts", "contacts", "contacts", "accounts"]);
    expect((calls[2].ops.find(([o]) => o === "update")![1][0] as Record<string, unknown>).account_id).toBe("A2");
    const stale = mk([ok({ ...acc, id: "A2", version: 6 })]);
    expect(await runAction(() => P.mergeAccounts(stale.c, "A1", "A2", { source: 3, target: 5 }, { merged: String, same: "s" }))).toMatchObject({ code: "conflict" });
    expect(await P.mergeAccounts(stale.c, "A1", "A1", { source: 3, target: 3 }, { merged: String, same: "same" })).toMatchObject({ ok: false, message: "same" });
  });
});

describe("contacts", () => {
  it("create dedupes on email, then inserts linked to the account", async () => {
    const dup = mk([list([con])]);
    expect(await P.createContact(dup.c, createContactSchema.parse({ fullName: "Asha", email: "asha@firm.in" }), cm)).toMatchObject({ ok: false, message: "dup email" });
    const fresh = mk([list([]), ok({ ...con, id: "NEW" })]);
    const r = await P.createContact(fresh.c, createContactSchema.parse({ fullName: "Ravi", phone: "98765 43211", accountId: "6f1c1f0e-1111-4111-8111-111111111111" }), cm);
    expect(r).toMatchObject({ ok: true, data: { id: "NEW" } });
    const ins = fresh.calls[1].ops.find(([o]) => o === "insert")![1][0] as Record<string, unknown>;
    expect(ins).toMatchObject({ phone: "9876543211", account_id: "6f1c1f0e-1111-4111-8111-111111111111", owner_id: UID });
  });
  it("update is versioned and delete is a versioned soft delete", async () => {
    const u = mk([ok([{ ...con, version: 3 }])]);
    expect(await P.updateContact(u.c, con, 2, { roleTitle: "Senior Partner" }, cm)).toMatchObject({ ok: true, data: { version: 3 } });
    const d = mk([ok([{ ...con, version: 3 }])]);
    expect((await P.deleteContact(d.c, "C1", 2, cm)).ok).toBe(true);
    expect(has(d.calls[0], "eq", "version", 2)).toBe(true);
  });
});

describe("export masking", () => {
  it("masks name, phone and email when masked; shows them only when unmasked", () => {
    const m = P.contactsCsv([con], { mask: true, accountNames: { A1: "Rao & Co" } });
    expect(m).not.toContain("Asha Rao");
    expect(m).not.toContain("9876543210");
    expect(m).not.toContain("asha@firm.in");
    expect(m).toContain("A. R.");
    const u = P.contactsCsv([con], { mask: false, accountNames: { A1: "Rao & Co" } });
    expect(u).toContain("Asha Rao");
    expect(u).toContain("asha@firm.in");
  });
  it("account export has no personal columns", () => {
    expect(P.accountsCsv([acc], { [UID]: "Meena" }).split("\n")[0]).not.toMatch(/phone|email/);
  });
});

describe("vertical vocabulary", () => {
  const legal = at(vocabFor({ id: "t", vertical: "legal" } as never));
  const hosp = at(vocabFor({ id: "t", vertical: "hospitality" } as never));
  it("legal says law firm, hospitality says guest/partner, never crossed", () => {
    expect(legal("created")).toBe("Law firm added");
    expect(hosp("created")).toBe("Guest/partner added");
    for (const k of ["conflictTitle", "notFound", "ui.add", "ui.deleteTitle", "ui.mergeHint"]) {
      expect(legal(k)).not.toMatch(/guest|partner/i);
      expect(hosp(k)).not.toMatch(/law firm/i);
    }
  });
});
