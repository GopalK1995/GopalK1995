// Page-level permissions for /accounts, /inbox and /ai (spec 10.2, 10.3).
// Built on the shared can() (support-aware). Actions the shared table does not name yet are listed here with the
// same support-session rules: read_only blocks every write; read_write blocks the never-list.
import { ROLE_LABEL, SUPPORT_BLOCKED, can, type Action } from "@/lib/auth/roles";
import type { Role } from "@/lib/data/types";

export type Support = { mode: "read_only" | "read_write" } | null | undefined;
export type EngageAction =
  | "createAccount" | "editAccount" | "addContact" | "createDeal" | "logActivity" | "assignAccount" | "importCsv" | "exportCsv"
  | "replyInbox" | "assignConversation" | "linkConversation"
  | "editScoreWeights" | "aiToggle" | "viewAiLog" | "askCrm";

/** Shared action used when one exists, otherwise the role list from spec 10.3. */
const MAP: Record<EngageAction, Action | Role[]> = {
  createAccount: ["owner", "sales_manager", "sales_rep", "data"],
  editAccount: ["owner", "sales_manager", "sales_rep", "data"],
  addContact: ["owner", "sales_manager", "sales_rep", "data"],
  createDeal: "moveDeals",
  logActivity: "workLeads",
  assignAccount: "assignLeads",
  importCsv: "importCsv",
  exportCsv: "exportCsv",
  replyInbox: "workLeads",
  assignConversation: "assignLeads",
  linkConversation: "workLeads",
  editScoreWeights: ["owner", "sales_manager"],
  aiToggle: "aiToggle",
  viewAiLog: ["owner", "sales_manager"],
  askCrm: ["owner", "sales_manager", "sales_rep", "marketing", "data"],
};
/** Sales Rep may do these only on records they own (spec 10.2 "R (+E own)"). */
const OWN_ONLY: EngageAction[] = ["editAccount", "addContact", "createDeal", "logActivity", "replyInbox", "linkConversation"];
const READS: EngageAction[] = ["askCrm", "viewAiLog"];

export type PermCtx = { role: Role; support?: Support; uid?: string; ownerId?: string };

export function allowed(action: EngageAction, ctx: PermCtx): boolean {
  const m = MAP[action];
  if (typeof m === "string") { if (!can(m, { role: ctx.role, support: ctx.support ?? null })) return false; }
  else {
    if (ctx.support && !READS.includes(action)) {
      if (ctx.support.mode === "read_only") return false;
    }
    if (!m.includes(ctx.role)) return false;
  }
  if (ctx.role === "sales_rep" && OWN_ONLY.includes(action) && ctx.ownerId && ctx.uid && ctx.ownerId !== ctx.uid) return false;
  return true;
}

/** One sentence for the disabled-button tooltip. */
export function deniedReason(action: EngageAction, ctx: PermCtx): string {
  const m = MAP[action];
  if (ctx.support) {
    if (typeof m === "string" && (SUPPORT_BLOCKED as readonly string[]).includes(m)) return "Not available in a support session.";
    if (ctx.support.mode === "read_only" && !READS.includes(action)) return "Read-only support session: changes are off.";
  }
  if (ctx.role === "sales_rep" && OWN_ONLY.includes(action) && ctx.ownerId && ctx.ownerId !== ctx.uid) return "Only the owning rep, a Sales Manager or the Owner can change this record.";
  return `Your role (${ROLE_LABEL[ctx.role]}) cannot do this.`;
}

export type Verdict = { ok: boolean; reason: string };
export const verdict = (action: EngageAction, ctx: PermCtx): Verdict => {
  const ok = allowed(action, ctx);
  return { ok, reason: ok ? "" : deniedReason(action, ctx) };
};

/** Server-action result: shown as a toast. Demo writes never persist. */
export type ActionResult = { ok: boolean; message: string; sub?: string };
