import { can, type Action } from "@/lib/auth/roles";

/** Spec 10.3 "Edit segment / ICP": Owner, Marketing, Data (not in the shared CAN table yet; requested from BUILD).
 *  Everything else defers to the shared can(), which already applies support-session restrictions. */
export type MktAction = Action | "editSegments";
export const canMkt = (action: MktAction, ctx: Parameters<typeof can>[1]) =>
  action === "editSegments"
    ? ctx.support?.mode !== "read_only" && (ctx.role === "owner" || ctx.role === "marketing" || ctx.role === "data")
    : can(action, ctx);
