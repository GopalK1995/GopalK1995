// Supabase implementation of SlackStore on the SERVICE-ROLE client (the alert job is a sanctioned user of serviceDb, CONTRACTS C6).
// RLS does not protect this path, so every query is explicitly scoped by workspace_id. Selects name their columns (never select *),
// contact details (email, phone) are never read.
import "server-only";
import type { Db } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import type { SlackStore } from "./store";

type R = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function supabaseSlackStore(db: Db): SlackStore {
  const one = async (table: string, cols: string, workspaceId: string, id: string): Promise<R | null> => {
    const { data, error } = await from(db, table).select(cols).eq("workspace_id", workspaceId).eq("id", id).limit(1);
    if (error) throw new Error("slack store: lookup failed");   // PostgREST text can quote values: not echoed
    return ((data as unknown as R[] | null) ?? [])[0] ?? null;
  };
  return {
    async describe(workspaceId, objectType, objectId, withName) {
      if (objectType === "lead") {
        const r = await one("leads", "id, full_name, source, city, status", workspaceId, objectId);
        if (!r) return null;
        return { name: withName ? str(r.full_name) : null, source: str(r.source), city: str(r.city), status: str(r.status), link: { type: "lead", id: objectId } };
      }
      if (objectType === "payment") {
        const r = await one("payments", "id, amount_paise, currency, lead_id, deal_id", workspaceId, objectId);
        if (!r) return null;
        const lead = str(r.lead_id), deal = str(r.deal_id);
        return { amountPaise: typeof r.amount_paise === "number" ? r.amount_paise : Number(r.amount_paise) || null, currency: str(r.currency), link: lead ? { type: "lead", id: lead } : deal ? { type: "deal", id: deal } : null };
      }
      return null;
    },
  };
}
