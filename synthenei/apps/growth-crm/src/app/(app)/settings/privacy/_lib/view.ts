// Loaders for the /settings/privacy pages: one view model for demo and real sessions. Real reads use the signed-in user's client (RLS).
// Demo data is clearly sample data. A failed read is an error state, never an empty list.
import { from } from "@/lib/db/query";
import type { Db } from "@/lib/db/client";
import { breachRepo, type Breach } from "@/lib/privacy/breach";
import { DEMO_RULES, demoBreaches, demoRequests } from "@/lib/privacy/demo";
import { ownerRepo, RequestError } from "@/lib/privacy/owner";
import { getPrT } from "@/lib/privacy/strings";
import { inboxCompare } from "@/lib/privacy/due";
import type { PrivacyRequest } from "@/lib/privacy/types";
import { gate, type Gate } from "./ctx";

export type Denied = Extract<Gate, { status: "denied" }>;
export type Row = PrivacyRequest & { leadLabel: string | null };
type R = Record<string, unknown>;

async function leadLabels(db: Db, ws: string, ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (!ids.length) return m;
  const { t } = await getPrT();
  const r = await from(db, "leads").select("id, full_name").eq("workspace_id", ws).in("id", ids).limit(500);
  if (r.error) return m;
  for (const x of (r.data as R[] | null) ?? []) m.set(String(x.id), String(x.full_name) === "Erased lead" ? t("owner.erasedLead") : String(x.full_name));
  return m;
}

export type InboxView = Denied | { status: "error" } | { status: "ok"; demo: boolean; rows: Row[]; publicPath: string; now: number };
export async function loadInbox(): Promise<InboxView> {
  const g = await gate();
  if (g.status === "denied") return g;
  const now = Date.now(), publicPath = `/privacy/${g.wsSlug}`;
  if (g.demo || !g.db) return { status: "ok", demo: true, rows: demoRequests(now, g.ws).sort(inboxCompare(now)), publicPath, now };
  try {
    const reqs = await ownerRepo(g.db, g.ws).list();
    const labels = await leadLabels(g.db, g.ws, [...new Set(reqs.map((r) => r.leadId).filter((x): x is string => !!x))]);
    return { status: "ok", demo: false, rows: reqs.map((r) => ({ ...r, leadLabel: r.leadId ? labels.get(r.leadId) ?? null : null })).sort(inboxCompare(now)), publicPath, now };
  } catch { return { status: "error" }; }
}

export type DetailView = Denied | { status: "error" } | { status: "missing" } | { status: "ok"; demo: boolean; req: Row; now: number; canErase: boolean };
export async function loadDetail(id: string): Promise<DetailView> {
  const g = await gate();
  if (g.status === "denied") return g;
  const now = Date.now();
  if (g.demo || !g.db) {
    const r = demoRequests(now, g.ws).find((x) => x.id === id);
    return r ? { status: "ok", demo: true, req: r, now, canErase: true } : { status: "missing" };
  }
  try {
    const req = await ownerRepo(g.db, g.ws).get(id);
    const labels = await leadLabels(g.db, g.ws, req.leadId ? [req.leadId] : []);
    return { status: "ok", demo: false, req: { ...req, leadLabel: req.leadId ? labels.get(req.leadId) ?? null : null }, now, canErase: g.role === "owner" };
  } catch (e) { return e instanceof RequestError && e.code === "not_found" ? { status: "missing" } : { status: "error" }; }
}

export interface RuleRow { objectType: string; days: number; action: "anonymise" | "delete" }
export type RetentionView = Denied | { status: "error" } | { status: "ok"; demo: boolean; rules: RuleRow[]; job: "on" | "off" | "unknown" };
export async function loadRetention(): Promise<RetentionView> {
  const g = await gate();
  if (g.status === "denied") return g;
  if (g.demo || !g.db) return { status: "ok", demo: true, rules: DEMO_RULES, job: "off" };
  try {
    const r = await from(g.db, "retention_policies").select("object_type, days, action").order("object_type", { ascending: true }).limit(100);
    if (r.error) return { status: "error" };
    const rules = ((r.data as R[] | null) ?? []).map((x): RuleRow => ({ objectType: String(x.object_type), days: Number(x.days), action: x.action === "delete" ? "delete" : "anonymise" }));
    // scheduled_jobs may not be readable by this role: then the honest answer is "unknown", not "off".
    const j = await from(g.db, "scheduled_jobs").select("enabled").eq("kind", "privacy.retention").limit(5);
    const job = j.error ? "unknown" : (((j.data as R[] | null) ?? []).some((x) => x.enabled === true) ? "on" : "off");
    return { status: "ok", demo: false, rules, job };
  } catch { return { status: "error" }; }
}

export type BreachView = Denied | { status: "error" } | { status: "setup" } | { status: "ok"; demo: boolean; rows: Breach[]; now: number };
export async function loadBreaches(): Promise<BreachView> {
  const g = await gate();
  if (g.status === "denied") return g;
  if (g.role !== "owner") return { status: "denied", reason: "role", roleLabel: g.role };   // the register is for owners only
  const now = Date.now();
  if (g.demo || !g.db) return { status: "ok", demo: true, rows: demoBreaches(now), now };
  try {
    const r = await breachRepo(g.db, g.ws).list();
    return "missing" in r ? { status: "setup" } : { status: "ok", demo: false, rows: r, now };
  } catch { return { status: "error" }; }
}
