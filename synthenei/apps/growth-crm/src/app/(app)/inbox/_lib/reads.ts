// Real-session reads. Unmasked callers read conversations/messages (internal notes included, for the team only).
// Masked callers (viewer: no pii.read) read the 0016 masked views; internal notes are dropped entirely and bodies stay masked.
import { dbForRequest } from "@/lib/db/client";
import { throwIfError } from "@/lib/db/errors";
import { toCamel } from "@/lib/db/map";
import { from } from "@/lib/db/query";
import type { DbProvider } from "@/lib/db/repo/base";

export type Row = Record<string, unknown>;
export interface RawInbox { convs: Row[]; msgs: Row[]; templates: Row[] }
const LIMIT = 200;

/** Message rows -> thread rows. Masked: notes are removed and text is the mask; unmasked: notes are kept and flagged. */
export function shapeMessages(rows: Row[], masked: boolean): Row[] {
  const out: Row[] = [];
  for (const r of rows) {
    const note = r.isInternalNote === true;
    if (masked) {
      if (note) continue; // an internal note never reaches a masked payload, not even as a placeholder
      out.push({ ...r, body: typeof r.bodyMasked === "string" ? r.bodyMasked : "••••••", bodyMasked: undefined });
    } else out.push(r);
  }
  return out;
}

export async function readInbox(ws: string, masked: boolean, getDb: DbProvider = dbForRequest): Promise<RawInbox> {
  const db = await getDb();
  const cv = await from(db, masked ? "v_conversations_masked" : "conversations").select().eq("workspace_id", ws).order("last_message_at", { ascending: false }).limit(LIMIT);
  throwIfError(cv.error);
  const convs = ((cv.data as Row[] | null) ?? []).map((r) => toCamel<Row>(r));
  if (!convs.length) return { convs, msgs: [], templates: [] };
  const ids = convs.map((c) => String(c.id));
  const ms = await from(db, masked ? "v_messages_masked" : "messages").select().eq("workspace_id", ws).in("conversation_id", ids).order("created_at", { ascending: true });
  throwIfError(ms.error);
  const msgs = shapeMessages(((ms.data as Row[] | null) ?? []).map((r) => toCamel<Row>(r)), masked);
  let templates: Row[] = [];
  if (!masked) {
    const tp = await from(db, "message_templates").select().eq("workspace_id", ws).eq("status", "approved");
    throwIfError(tp.error);
    templates = ((tp.data as Row[] | null) ?? []).map((r) => toCamel<Row>(r));
  }
  return { convs, msgs, templates };
}
