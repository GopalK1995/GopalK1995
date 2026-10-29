"use server";
// Contact mutations (T015). Real sessions: assertCan on THAT contact (own/team scope) -> contacts repository with the
// version the page rendered. Demo sessions describe what would happen and never touch Supabase.
import { pageCtx } from "@/lib/data/context";
import { vocabFor } from "@/lib/vertical";
import { assertCan } from "@/lib/authz/load";
import { can as engineCan } from "@/lib/authz";
import { failResult, okResult, type ActionResult } from "@/lib/actions/result";
import { DbError } from "@/lib/db/errors";
import { accountsRepo } from "@/lib/db/repo/accounts";
import { contactsRepo } from "@/lib/db/repo/contacts";
import type { Contact } from "@/lib/db/repo/types";
import { allowed, deniedReason } from "../accounts/_components/perms";
import * as P from "../accounts/_lib/persist";
import { realRun } from "../accounts/_lib/run";
import { createContactSchema, deleteSchema, updateContactSchema } from "../accounts/_lib/schemas";
import { at } from "../accounts/_lib/strings";

const DEMO_SUB = "Demo workspace: nothing was saved or sent.";
type Ctx = Awaited<ReturnType<typeof pageCtx>>;
const repos: P.Repos = { accounts: accountsRepo, contacts: contactsRepo };
const pctx = (ctx: Ctx): P.Ctx => ({ ws: ctx.active.ws.uuid, uid: ctx.session.uid, repos });
const recOf = (ctx: Ctx, c: Contact) => ({ type: "contact" as const, id: c.id, workspaceId: ctx.active.ws.id, ownerId: c.ownerId });
const invalid = (e: { issues: { path: PropertyKey[]; message: string }[] }): ActionResult<never> =>
  failResult("invalid", e.issues[0]?.message ?? "Some values are not valid.", { issues: e.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) }) as ActionResult<never>;
const denyDemo = (ctx: Ctx, ownerId?: string): ActionResult<never> =>
  failResult("denied", deniedReason("addContact", { role: ctx.role, support: ctx.support, uid: ctx.session.uid, ownerId })) as ActionResult<never>;

function msgs(ctx: Ctx): P.ContactMsgs {
  const t = at(vocabFor(ctx.active.tenant));
  return { created: t("contactCreated"), saved: t("contactSaved"), deleted: t("contactDeleted"), duplicate: (field) => t("contactDuplicate", { field }) };
}

async function realContact(ctx: Ctx, perm: string, id: string): Promise<Contact> {
  const c = await contactsRepo.get(ctx.active.ws.uuid, id);
  if (!c) throw new DbError("not_found", "not_found");
  await assertCan(perm, recOf(ctx, c));
  return c;
}

export async function createContact(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await pageCtx();
  const v = vocabFor(ctx.active.tenant), t = at(v);
  if (ctx.session.demo) {
    if (!allowed("addContact", { role: ctx.role, support: ctx.support })) return denyDemo(ctx);
    const p = createContactSchema.safeParse(input);
    if (!p.success) return invalid(p.error);
    return okResult(t("contactCreated"), { sub: DEMO_SUB });
  }
  return realRun(v, ctx.support, async () => {
    await assertCan("contacts.write");
    const p = createContactSchema.safeParse(input);
    if (!p.success) return invalid(p.error);
    if (p.data.accountId) { // the linked account must be visible to the caller and live in this workspace
      const a = await accountsRepo.get(ctx.active.ws.uuid, p.data.accountId);
      if (!a) throw new DbError("not_found", "not_found");
      await assertCan("accounts.read", { type: "account", id: a.id, workspaceId: ctx.active.ws.id, ownerId: a.ownerId });
    }
    return P.createContact(pctx(ctx), p.data, msgs(ctx));
  });
}

export async function updateContact(contactId: string, input: unknown): Promise<ActionResult<{ version: number }>> {
  const ctx = await pageCtx();
  const v = vocabFor(ctx.active.tenant), t = at(v);
  const p = updateContactSchema.safeParse(input);
  if (ctx.session.demo) {
    if (!allowed("addContact", { role: ctx.role, support: ctx.support })) return denyDemo(ctx);
    if (!p.success) return invalid(p.error);
    return okResult(t("contactSaved"), { sub: DEMO_SUB });
  }
  return realRun(v, ctx.support, async () => {
    const cur = await realContact(ctx, "contacts.write", contactId);
    if (!p.success) return invalid(p.error);
    return P.updateContact(pctx(ctx), cur, p.data.expectedVersion, p.data.patch, msgs(ctx));
  });
}

export async function deleteContact(contactId: string, input: unknown): Promise<ActionResult> {
  const ctx = await pageCtx();
  const v = vocabFor(ctx.active.tenant), t = at(v);
  const p = deleteSchema.safeParse(input);
  if (ctx.session.demo) {
    if (!allowed("addContact", { role: ctx.role, support: ctx.support })) return denyDemo(ctx);
    return okResult(t("contactDeleted"), { sub: DEMO_SUB });
  }
  return realRun(v, ctx.support, async () => {
    await realContact(ctx, "contacts.delete", contactId); // starred: blocked in support sessions
    if (!p.success) return invalid(p.error);
    return P.deleteContact(pctx(ctx), contactId, p.data.expectedVersion, msgs(ctx));
  });
}

/** Contacts export: names, phone and email are masked unless the caller holds pii.read AND unticked "Mask". */
export async function exportContacts(maskPersonal: boolean): Promise<ActionResult & { csv?: string; filename?: string }> {
  const ctx = await pageCtx();
  const v = vocabFor(ctx.active.tenant), t = at(v);
  const filename = `contacts-${ctx.active.ws.id}-${new Date().toISOString().slice(0, 10)}.csv`;
  if (ctx.session.demo) {
    if (!allowed("exportCsv", { role: ctx.role, support: ctx.support })) return denyDemo(ctx);
    return { ...okResult(t("exported", { n: 0 }), { sub: DEMO_SUB }), csv: "contact_id,name,role,account,decision_maker,phone,email,created_at", filename };
  }
  const r = await realRun(v, ctx.support, async () => {
    const principal = await assertCan("contacts.read");
    if (ctx.support || !allowed("exportCsv", { role: ctx.role, support: ctx.support })) return failResult("denied", t("exportSupport"));
    const rows: Contact[] = [];
    let cursor: string | undefined;
    do {
      const pg = await contactsRepo.list(ctx.active.ws.uuid, { limit: 200, cursor });
      rows.push(...pg.rows.filter((c) => engineCan(principal, "contacts.read", recOf(ctx, c))));
      cursor = pg.nextCursor ?? undefined;
    } while (cursor && rows.length < 5000);
    const mask = maskPersonal || !engineCan(principal, "pii.read");
    const accountNames: Record<string, string> = {};
    for (const a of (await accountsRepo.list(ctx.active.ws.uuid, { limit: 200 })).rows) accountNames[a.id] = a.name;
    return okResult(t("exported", { n: rows.length }), { sub: mask && !maskPersonal ? t("exportMasked") : t("exportedSub"), data: { csv: P.contactsCsv(rows, { mask, accountNames }) } });
  });
  if (!r.ok) return r;
  const { data, ...rest } = r;
  return { ...rest, csv: (data as { csv: string } | undefined)?.csv, filename };
}
