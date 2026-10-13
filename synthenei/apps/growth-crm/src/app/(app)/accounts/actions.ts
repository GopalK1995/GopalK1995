"use server";
// Account mutations. Every action re-checks the permission on the server (role, ownership, support session).
// Demo mode never persists: the result describes what would be written and audit-logged.
import { pageCtx } from "@/lib/data/context";
import { allowed, deniedReason, type ActionResult, type EngageAction } from "./_components/perms";

type Kind = Extract<EngageAction, "createAccount" | "editAccount" | "addContact" | "createDeal" | "logActivity" | "assignAccount" | "importCsv" | "exportCsv">;

export async function accountAction(kind: Kind, accountId: string | null, form: Record<string, string>): Promise<ActionResult> {
  const { ds, role, support, session } = await pageCtx();
  const acc = accountId ? await ds.account(accountId) : null;
  if (accountId && !acc) return { ok: false, message: "That firm is not in this workspace.", sub: "Nothing was changed." };
  const ctx = { role, support, uid: session.uid, ownerId: acc?.ownerId };
  if (!allowed(kind, ctx)) return { ok: false, message: deniedReason(kind, ctx), sub: "Checked on the server; nothing was changed." };
  const firm = acc?.name ?? form.name ?? "the firm";
  const demo = session.demo ? "Demo: nothing was saved." : "Saved and audit-logged.";
  const clean = (s?: string) => (s ?? "").trim().slice(0, 120);
  switch (kind) {
    case "addContact":
      if (!clean(form.name)) return { ok: false, message: "Add the contact's name first." };
      return { ok: true, message: `${clean(form.name)} (${clean(form.title) || "contact"}) added to ${firm}`, sub: `${demo} Consent is recorded separately when they opt in.` };
    case "createDeal":
      return { ok: true, message: `Deal opened: ${firm}, ${clean(form.plan) || "Chambers"} (${clean(form.seats) || "8"} seats)`, sub: `${demo} Stage set to Discovery.` };
    case "logActivity":
      return { ok: true, message: `${clean(form.kind) || "Note"} logged on ${firm}`, sub: demo };
    case "editAccount":
      return { ok: true, message: `Firm profile updated: ${firm}`, sub: demo };
    case "assignAccount":
      return { ok: true, message: `${firm} reassigned`, sub: demo };
    case "createAccount":
      if (!clean(form.name)) return { ok: false, message: "Add the firm name first." };
      return { ok: true, message: `${clean(form.name)} added as a prospect`, sub: `${demo} Duplicate check runs on name + district.` };
    case "importCsv":
      return { ok: true, message: "CSV import opened", sub: "Demo: upload is disabled; mapping preview only." };
    case "exportCsv":
      return { ok: true, message: "Export queued (audit-logged)", sub: "Demo: no file was generated." };
  }
}
