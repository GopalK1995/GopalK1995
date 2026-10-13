import { can, type Action } from "@/lib/auth/roles";

/** Marketing pages use the shared, support-aware can() (incl. editSegments: Owner, Marketing, Data per spec 10.3). */
export type MktAction = Action;
export const canMkt = (action: MktAction, ctx: Parameters<typeof can>[1]) => can(action, ctx);
