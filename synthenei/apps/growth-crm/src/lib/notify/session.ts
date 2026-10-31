// Server-side session facts the collaboration actions need. Imports next/headers via auth/server: server code only.
import { requireActive } from "@/lib/auth/server";
import { can } from "@/lib/authz";
import { loadPrincipal } from "@/lib/authz/load";

export interface CollabCtx {
  uid: string; name: string; demo: boolean;
  /** Workspace uuid (database id). */
  ws: string;
  /** Workspace key used by the authz layer. */
  wsKey: string;
  readOnlySupport: boolean;
}
export async function collabCtx(): Promise<CollabCtx> {
  const { session, active } = await requireActive();
  return {
    uid: session.uid, name: session.name, demo: session.demo, ws: active.ws.uuid, wsKey: active.ws.id,
    readOnlySupport: active.support?.mode === "read_only",
  };
}
/** Workspace-level check for a permission key, without throwing. */
export async function canDo(perm: string): Promise<boolean> {
  return can(await loadPrincipal(), perm);
}
