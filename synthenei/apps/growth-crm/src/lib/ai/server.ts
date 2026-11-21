// Server glue between the signed-in request and the gateway: who is calling, which records the prompt may be built from, and how a gateway
// error becomes a message. Records are read under the CALLER'S JWT, so row-level security decides what the model may see (a rep's draft is
// built only from conversations and leads that rep can open). Never imported by client code.
import "server-only";
import { requireActive } from "@/lib/auth/server";
import { dbForRequest, type Db } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import { throwIfError } from "@/lib/db/errors";
import { assertCan } from "@/lib/authz/load";
import type { Principal } from "@/lib/authz";
import { runAi } from "./gateway";
import { requestGateway } from "./store";
import { AiError, type AiCaller, type AiRequest, type AiResponse, type GatewayDeps } from "./types";
import type { LeadFacts, ThreadMsg } from "./features";

export interface AiCtx { uid: string; tenantId: string; wsId: string; principal: Principal; db: Db; who: AiCaller; deps: GatewayDeps }

const DAY = 86400e3;
const daysAgo = (iso: string | null | undefined, now: number) => (iso ? Math.max(0, Math.round((now - Date.parse(iso)) / DAY)) : null);

/** Real sessions only. Demo sessions have no database and no gateway (the page shows showcase content), and support sessions never run the model. */
export async function aiCtx(perm: "ai.use" | "ai.toggle"): Promise<AiCtx | { demo: true }> {
  const { session, active } = await requireActive();
  const principal = await assertCan(perm);
  if (session.demo === true) return { demo: true };
  if (active.support) throw new AiError("invalid", "AI is not available in a support session");
  const db = await dbForRequest();
  const w = await from(db, "workspaces").select("tenant_id").eq("id", active.ws.uuid).maybeSingle();
  throwIfError(w.error);
  const tenantId = String((w.data as { tenant_id?: string } | null)?.tenant_id ?? "");
  if (!tenantId) throw new AiError("invalid", "Workspace not found");
  const deps = await requestGateway();
  return { uid: session.uid, tenantId, wsId: active.ws.uuid, principal, db, deps, who: { tenantId, workspaceId: active.ws.uuid, principalKind: "user", principalId: session.uid } };
}
export const isDemo = (c: AiCtx | { demo: true }): c is { demo: true } => "demo" in c;

export const call = (c: AiCtx, req: AiRequest): Promise<AiResponse> => runAi(c.deps, c.who, req);

export async function loadThread(c: AiCtx, conversationId: string): Promise<{ firstName: string; channel: string; stage: string | null; lastInboundAt: string | null; leadId: string | null; thread: ThreadMsg[] } | null> {
  const cv = await from(c.db, "conversations").select("id, channel, lead_id, last_inbound_at").eq("id", conversationId).eq("workspace_id", c.wsId).maybeSingle();
  throwIfError(cv.error);
  const conv = cv.data as { channel: string; lead_id: string | null; last_inbound_at: string | null } | null;
  if (!conv) return null;
  const ms = await from(c.db, "messages").select("direction, body, created_at").eq("conversation_id", conversationId).eq("is_internal_note", false).order("created_at", { ascending: false }).limit(12);
  throwIfError(ms.error);
  const thread: ThreadMsg[] = ((ms.data as { direction: string; body: string | null; created_at: string }[]) ?? []).reverse()
    .filter((m) => m.body).map((m) => ({ from: m.direction === "inbound" ? "lead" as const : "us" as const, at: m.created_at, body: m.body as string }));
  let firstName = "", stage: string | null = null;
  if (conv.lead_id) {
    const l = await from(c.db, "leads").select("full_name, status").eq("id", conv.lead_id).maybeSingle();
    const row = l.data as { full_name?: string; status?: string } | null;
    firstName = (row?.full_name ?? "").trim().split(/\s+/)[0] ?? ""; stage = row?.status ?? null;
  }
  return { firstName, channel: conv.channel, stage, lastInboundAt: conv.last_inbound_at, leadId: conv.lead_id, thread };
}

export async function loadLeadFacts(c: AiCtx, leadId: string): Promise<LeadFacts | null> {
  const now = Date.now();
  const l = await from(c.db, "leads").select("id, status, source, role_title, city, score, score_factors, created_at, last_touch_at").eq("id", leadId).eq("workspace_id", c.wsId).maybeSingle();
  throwIfError(l.error);
  const lead = l.data as Record<string, unknown> | null;
  if (!lead) return null;
  const [acts, tasks] = await Promise.all([
    from(c.db, "activities").select("kind, subject, body, created_at").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(15),
    from(c.db, "tasks").select("title, due_at").eq("lead_id", leadId).eq("status", "open").order("due_at").limit(5),
  ]);
  throwIfError(acts.error); throwIfError(tasks.error);
  const factors = (Array.isArray(lead.score_factors) ? lead.score_factors : []).map((f) => f as { label?: unknown; points?: unknown })
    .filter((f) => typeof f.label === "string" && typeof f.points === "number").map((f) => ({ label: f.label as string, points: f.points as number }));
  return {
    stage: String(lead.status ?? "unknown"), source: (lead.source as string | null) ?? null, title: (lead.role_title as string | null) ?? null, city: (lead.city as string | null) ?? null,
    score: typeof lead.score === "number" ? lead.score : null, factors, createdDaysAgo: daysAgo(lead.created_at as string, now) ?? 0, lastTouchDaysAgo: daysAgo(lead.last_touch_at as string | null, now),
    openTasks: ((tasks.data as { title: string; due_at: string }[]) ?? []).map((t) => ({ title: t.title, dueDays: Math.round((Date.parse(t.due_at) - now) / DAY) })),
    activities: ((acts.data as { kind: string; subject: string | null; body: string | null; created_at: string }[]) ?? []).map((a) => ({ kind: a.kind, daysAgo: daysAgo(a.created_at, now) ?? 0, text: a.subject || a.body || "" })),
  };
}

/** Human message for a gateway failure, from the ai namespace (err.<code> and err.<code>Sub). Codes are stable; vendor detail never reaches the text. */
export type AiT = (key: string, values?: Record<string, string | number>) => string;
export function aiErrorMessage(e: unknown, t: AiT): { code: string; message: string; sub?: string } {
  const code = e instanceof AiError ? e.code : "error";
  const known = ["feature_off", "cap_reached", "no_key", "no_provider", "model_not_allowed", "rate_limited", "audit_failed", "bad_output", "policy_unavailable"].includes(code) ? code : "error";
  const sub = t(`err.${known}Sub`);
  return { code, message: t(`err.${known}`), sub: sub || undefined };
}
