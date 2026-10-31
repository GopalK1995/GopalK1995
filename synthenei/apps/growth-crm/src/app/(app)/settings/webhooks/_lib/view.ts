// Server-side loaders for /settings/webhooks and /settings/webhooks/[id]: one view model for demo and real sessions.
import { requireActive } from "@/lib/auth/server";
import { can } from "@/lib/authz/engine";
import { loadPrincipal } from "@/lib/authz/load";
import { dbForRequest } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import { ALL_EVENT_TYPES } from "@/lib/events/catalog";
import { getEndpoint, listDeliveries, listEndpoints, toDeliveryView, toView, type DeliveryView, type EndpointView } from "@/lib/webhooks/admin";
import type { EventOption } from "./types";

export const EVENT_OPTIONS: EventOption[] = ALL_EVENT_TYPES.filter((t) => t.webhook).map((t) => ({ type: t.type, description: t.description, domain: t.type.split(".")[0] }));

export type Denied = { status: "denied"; reason: "support" | "role"; roleLabel: string };
export type ListResult =
  | { status: "ok"; demo: boolean; endpoints: EndpointView[]; events: EventOption[]; policyOff: boolean; mayPii: boolean; isOwner: boolean }
  | Denied
  | { status: "error" };
export type LogResult =
  | { status: "ok"; demo: boolean; endpoint: EndpointView; deliveries: DeliveryView[]; isOwner: boolean }
  | Denied
  | { status: "not_found" }
  | { status: "error" };

const DEMO_ENDPOINTS: EndpointView[] = [
  { id: "demo-1", url: "https://hooks.example.com/crm/leads", description: "Lead intake to the data warehouse", eventTypes: ["lead.created", "lead.stage_changed", "deal.won"], includePii: false, filters: [], active: true, disabledReason: null, consecutiveFailures: 0, createdAt: "2026-09-18T10:00:00.000Z", rotatedAt: null, graceUntil: null },
  { id: "demo-2", url: "https://automation.example.org/webhooks/crm", description: "Slack alerts for won deals", eventTypes: ["deal.won"], includePii: false, filters: [{ field: "object_type", values: ["deal"] }], active: false, disabledReason: "auto_failures", consecutiveFailures: 24, createdAt: "2026-10-02T10:00:00.000Z", rotatedAt: null, graceUntil: null },
];
const DEMO_DELIVERIES: DeliveryView[] = [
  { id: 3, createdAt: "2026-10-30T09:12:00.000Z", eventType: "deal.won", eventId: "9001", attempt: 1, status: "succeeded", responseStatus: 200, responseMs: 182, excerpt: "ok", nextAttemptAt: null },
  { id: 2, createdAt: "2026-10-29T16:40:00.000Z", eventType: "lead.stage_changed", eventId: "8990", attempt: 3, status: "failed", responseStatus: 503, responseMs: 1210, excerpt: "service unavailable", nextAttemptAt: "2026-10-29T17:50:00.000Z" },
  { id: 1, createdAt: "2026-10-28T08:03:00.000Z", eventType: "lead.created", eventId: "8955", attempt: 7, status: "dead", responseStatus: null, responseMs: 10000, excerpt: "timeout", nextAttemptAt: null },
];

async function access(): Promise<{ denied: Denied } | { demo: boolean; isOwner: boolean; mayPii: boolean; wsUuid: string; wsName: string }> {
  const { session, active } = await requireActive();
  if (active.support) return { denied: { status: "denied", reason: "support", roleLabel: active.role } };
  const demo = session.demo === true;
  const p = await loadPrincipal();
  // The demo fixture roles come from the legacy matrix, which has no webhooks.manage: owner-only integrations.manage stands in.
  if (!(demo ? can(p, "integrations.manage") : can(p, "webhooks.manage"))) return { denied: { status: "denied", reason: "role", roleLabel: active.role } };
  return { demo, isOwner: active.role === "owner", mayPii: can(p, "pii.read"), wsUuid: active.ws.uuid, wsName: active.ws.name };
}

export async function loadEndpoints(): Promise<ListResult> {
  const a = await access();
  if ("denied" in a) return a.denied;
  if (a.demo) return { status: "ok", demo: true, endpoints: DEMO_ENDPOINTS, events: EVENT_OPTIONS, policyOff: false, mayPii: a.mayPii, isOwner: a.isOwner };
  try {
    const db = await dbForRequest();
    const rows = await listEndpoints(db, a.wsUuid);
    const ws = await from(db, "workspaces").select("tenant_id").eq("id", a.wsUuid).maybeSingle();
    const tenant = (ws.data as { tenant_id?: string } | null)?.tenant_id;
    let policyOff = false;
    if (tenant) {
      const pol = await from(db, "org_admin_policies").select("allow_webhooks").eq("tenant_id", tenant).maybeSingle();
      policyOff = !pol.error && (pol.data as { allow_webhooks?: boolean } | null)?.allow_webhooks === false;
    }
    return { status: "ok", demo: false, endpoints: rows.map((r) => toView(r)), events: EVENT_OPTIONS, policyOff, mayPii: a.mayPii, isOwner: a.isOwner };
  } catch {
    return { status: "error" };
  }
}

export async function loadDeliveries(id: string, status?: string): Promise<LogResult> {
  const a = await access();
  if ("denied" in a) return a.denied;
  if (a.demo) {
    const e = DEMO_ENDPOINTS.find((x) => x.id === id);
    return e ? { status: "ok", demo: true, endpoint: e, deliveries: status ? DEMO_DELIVERIES.filter((d) => d.status === status) : DEMO_DELIVERIES, isOwner: a.isOwner } : { status: "not_found" };
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: "not_found" };
  try {
    const db = await dbForRequest();
    const e = await getEndpoint(db, a.wsUuid, id);
    if (!e) return { status: "not_found" };
    const rows = await listDeliveries(db, e.id, { status: status && ["pending", "succeeded", "failed", "dead"].includes(status) ? status : undefined, limit: 100 });
    return { status: "ok", demo: false, endpoint: toView(e), deliveries: rows.map(toDeliveryView), isOwner: a.isOwner };
  } catch {
    return { status: "error" };
  }
}
