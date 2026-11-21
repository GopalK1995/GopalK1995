// Server-only: the recorded first/last touch per lead for a real session (request client, so RLS applies). Demo sessions get undefined.
import "server-only";
import { dbForRequest } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import type { Touches } from "./touches";

export async function loadTouches(workspaceId: string, sinceIso: string): Promise<Touches> {
  const db = await dbForRequest();
  const r = await from(db, "leads").select("id, first_touch_channel, last_touch_channel").eq("workspace_id", workspaceId).gte("created_at", sinceIso).is("deleted_at", null).limit(5000);
  if (r.error) throw new Error("Could not read lead touches");
  const out: Touches = new Map();
  for (const row of (r.data as Record<string, unknown>[] | null) ?? []) {
    const s = (v: unknown) => (typeof v === "string" && v ? v : null);
    out.set(String(row.id), { first: s(row.first_touch_channel), last: s(row.last_touch_channel) });
  }
  return out;
}
