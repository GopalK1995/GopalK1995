"use server";
// Persisted account actions (T015). Real sessions: assertCan on THAT record -> repository (version checked) -> ActionResult.
// Demo sessions: the legacy role guard, then "what would have happened"; they never touch Supabase.
// Audit rows and account.* / contact.* events are written by the DB triggers (0014), so "Saved" is only returned after commit.
import { pageCtx } from "@/lib/data/context";
import { vocabFor } from "@/lib/vertical";
import { assertCan } from "@/lib/authz/load";
import { can as engineCan } from "@/lib/authz";
import { failResult, okResult, type ActionResult } from "@/lib/actions/result";
import { DbError } from "@/lib/db/errors";
import { accountsRepo } from "@/lib/db/repo/accounts";
import { contactsRepo } from "@/lib/db/repo/contacts";
import type { Account } from "@/lib/db/repo/types";
import { allowed, deniedReason, type EngageAction } from "./_components/perms";
import * as P from "./_lib/persist";
import { realRun } from "./_lib/run";
import { assignAccountSchema, createAccountSchema, deleteSchema, mergeSchema, updateAccountSchema } from "./_lib/schemas";
import { at } from "./_lib/strings";

const DEMO_SUB = "Demo workspace: nothing was saved or sent.";
type Ctx = Awaited<ReturnType<typeof pageCtx>>;
const repos: P.Repos = { accounts: accountsRepo, contacts: contactsRepo };
const pctx = (ctx: Ctx): P.Ctx => ({ ws: ctx.active.ws.uuid, uid: ctx.session.uid, repos });
const recOf = (ctx: Ctx, a: Account) => ({ type: "account" as const, id: a.id, workspaceId: ctx.active.ws.id, ownerId: a.ownerId });
const deny = (ctx: Ctx, kind: EngageAction, ownerId?: string): ActionResult<never> =>
  failResult("denied", deniedReason(kind, { role: ctx.role, support: ctx.support, uid: ctx.session.uid, ownerId })) as ActionResult<never>;
const invalid = (e: { issues: { path: PropertyKey[]; message: string }[] }): ActionResult<never> =>
  failResult("invalid", e.issues[0]?.message ?? "Some values are not valid.", { issues: e.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) }) as ActionResult<never>;

function msgs(ctx: Ctx): P.AccountMsgs {
  const t = at(vocabFor(ctx.active.tenant));
  return { created: t("created"), saved: t("saved"), assigned: t("assigned"), deleted: t("deleted"), duplicate: (name, where) => t("duplicate", { name, where }) };
}

async function realAccount(ctx: Ctx, perm: string | string[], id: string): Promise<Account> {
  const a = await accountsRepo.get(ctx.active.ws.uuid, id);
  if (!a) throw new DbError("not_found", "not_found");
  for (const p of Array.isArray(perm) ? perm : [perm]) await assertCan(p, recOf(ctx, a));
  return a;
}

async function demoAccount(ctx: Ctx, kind: EngageAction, id: string): Promise<{ error: ActionResult<never> } | { ok: true }> {
  const acc = await ctx.ds.account(id);
  const t = at(vocabFor(ctx.active.tenant));
  if (!acc) return { error: failResult("not_found", t("notFound")) as ActionResult<never> };
  if (!allowed(kind, { role: ctx.role, support: ctx.support, uid: ctx.session.uid, ownerId: acc.ownerId })) return { error: deny(ctx, kind, acc.ownerId) };
  return { ok: true };
}

export async function createAccount(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await pageCtx();
  const v = vocabFor(ctx.active.tenant), t = at(v);
  if (ctx.session.demo) {
    if (!allowed("createAccount", { role: ctx.role, support: ctx.support })) return deny(ctx, "createAccount");
    const p = createAccountSchema.safeParse(input);
    if (!p.success) return invalid(p.error);
    return okResult(t("created"), { sub: DEMO_SUB });
  }
  return realRun<{ id: string }>(v, ctx.support, async () => {
    await assertCan("accounts.write");
    const p = createAccountSchema.safeParse(input);
    if (!p.success) return invalid(p.error);
    const r = await P.createAccount(pctx(ctx), p.data, msgs(ctx));
    return r.ok ? { ...r, sub: t("createdSub") } : r;
  });
}

export async function updateAccount(accountId: string, input: unknown): Promise<ActionResult<{ version: number }>> {
  const ctx = await pageCtx();
  const v = vocabFor(ctx.active.tenant), t = at(v);
  const p = updateAccountSchema.safeParse(input);
  if (ctx.session.demo) {
    const g = await demoAccount(ctx, "editAccount", accountId);
    if ("error" in g) return g.error;
    if (!p.success) return invalid(p.error);
    return okResult(t("saved"), { sub: DEMO_SUB });
  }
  return realRun(v, ctx.support, async () => {
    const cur = await realAccount(ctx, "accounts.write", accountId);
    if (!p.success) return invalid(p.error);
    return P.updateAccount(pctx(ctx), cur, p.data.expectedVersion, p.data.patch, msgs(ctx));
  });
}

export async function assignAccountOwner(accountId: string, input: unknown): Promise<ActionResult<{ version: number }>> {
  const ctx = await pageCtx();
  const v = vocabFor(ctx.active.tenant), t = at(v);
  const p = assignAccountSchema.safeParse(input);
  if (ctx.session.demo) {
    const g = await demoAccount(ctx, "assignAccount", accountId);
    if ("error" in g) return g.error;
    if (!p.success) return invalid(p.error);
    return okResult(t("assigned"), { sub: DEMO_SUB });
  }
  return realRun<{ version: number }>(v, ctx.support, async () => {
    await realAccount(ctx, ["accounts.write", "leads.assign"], accountId);
    if (!p.success) return invalid(p.error);
    const r = await P.assignAccount(pctx(ctx), accountId, p.data.expectedVersion, p.data.ownerId, msgs(ctx));
    return r.ok ? { ...r, sub: t("assignedSub") } : r;
  });
}

export async function deleteAccount(accountId: string, input: unknown): Promise<ActionResult> {
  const ctx = await pageCtx();
  const v = vocabFor(ctx.active.tenant), t = at(v);
  const p = deleteSchema.safeParse(input);
  if (ctx.session.demo) {
    const g = await demoAccount(ctx, "deleteAccount", accountId);
    if ("error" in g) return g.error;
    return okResult(t("deleted"), { sub: DEMO_SUB });
  }
  return realRun(v, ctx.support, async () => {
    await realAccount(ctx, "accounts.delete", accountId); // starred in the catalogue: blocked in support sessions
    if (!p.success) return invalid(p.error);
    const r = await P.deleteAccount(pctx(ctx), accountId, p.data.expectedVersion, { deleted: t("deleted"), blocked: (n) => t("deleteBlocked", { n }) });
    return r.ok ? { ...r, sub: t("deletedSub") } : r;
  });
}

export async function mergeAccounts(sourceId: string, input: unknown): Promise<ActionResult<{ moved: number }>> {
  const ctx = await pageCtx();
  const v = vocabFor(ctx.active.tenant), t = at(v);
  const p = mergeSchema.safeParse(input);
  if (ctx.session.demo) {
    const g = await demoAccount(ctx, "mergeAccount", sourceId);
    if ("error" in g) return g.error;
    if (!p.success) return invalid(p.error);
    if (p.data.targetId === sourceId) return failResult("invalid", t("mergeSame"));
    return okResult(t("merged", { target: (await ctx.ds.account(p.data.targetId))?.name ?? "" }), { sub: DEMO_SUB });
  }
  return realRun<{ moved: number }>(v, ctx.support, async () => {
    const src = await realAccount(ctx, "accounts.merge", sourceId);
    if (!p.success) return invalid(p.error);
    const tgt = await realAccount(ctx, "accounts.merge", p.data.targetId);
    const r = await P.mergeAccounts(pctx(ctx), src.id, tgt.id, { source: p.data.sourceVersion, target: p.data.targetVersion }, { merged: () => t("merged", { target: tgt.name }), same: t("mergeSame") });
    return r.ok ? { ...r, sub: t("mergedSub", { n: r.data?.moved ?? 0 }) } : r;
  });
}

/** Account export carries no personal data. Real: needs accounts.read, blocked in support sessions. */
export async function exportAccounts(): Promise<ActionResult & { csv?: string; filename?: string }> {
  const ctx = await pageCtx();
  const v = vocabFor(ctx.active.tenant), t = at(v);
  const name = `accounts-${ctx.active.ws.id}-${new Date().toISOString().slice(0, 10)}.csv`;
  if (ctx.session.demo) {
    if (!allowed("exportCsv", { role: ctx.role, support: ctx.support })) return deny(ctx, "exportCsv");
    const rows = await ctx.ds.accounts();
    const own = ctx.role === "sales_rep" ? rows.filter((a) => a.ownerId === ctx.session.uid) : rows;
    const csv = ["account_id,name,city,district,status", ...own.map((a) => [a.id, `"${a.name.replace(/"/g, '""')}"`, a.city, a.district, a.status].join(","))].join("\n");
    return { ...okResult(t("exported", { n: own.length }), { sub: t("exportedSub") }), csv, filename: name };
  }
  const r = await realRun(v, ctx.support, async () => {
    const principal = await assertCan("accounts.read");
    if (ctx.support || !allowed("exportCsv", { role: ctx.role, support: ctx.support })) return failResult("denied", t("exportSupport"));
    const rows: Account[] = [];
    let cursor: string | undefined;
    do {
      const pg = await accountsRepo.list(ctx.active.ws.uuid, { limit: 200, cursor });
      rows.push(...pg.rows.filter((a) => engineCan(principal, "accounts.read", recOf(ctx, a))));
      cursor = pg.nextCursor ?? undefined;
    } while (cursor && rows.length < 5000);
    const ownerNames = Object.fromEntries((await ctx.ds.team()).map((m) => [m.id, m.name]));
    return okResult(t("exported", { n: rows.length }), { sub: t("exportedSub"), data: { csv: P.accountsCsv(rows, ownerNames) } });
  });
  if (!r.ok) return r;
  const { data, ...rest } = r;
  return { ...rest, csv: (data as { csv: string } | undefined)?.csv, filename: name };
}
