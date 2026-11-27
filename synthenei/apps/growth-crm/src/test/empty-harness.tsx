// Test harness: render a server page against a completely empty (or demo) workspace without Next, cookies or a database.
// Pages call pageCtx() / loadPrincipal() / getT(); the page tests vi.mock those three modules to the factories below.
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { resolveEffective } from "@/lib/config/resolve-pure";
import { stageList } from "@/lib/config/types";
import { systemPrincipal } from "@/lib/authz/principal";
import { slaHoursFrom } from "@/lib/sla/business-hours";
import { AI_OFF } from "@/lib/data/supabase/reads";
import { mockSource, type DataSource } from "@/lib/data/source";
import { datasetFor } from "@/lib/data/mock/generate-index";
import { activeFromRow } from "@/lib/tenancy";
import { WORKSPACES, TENANTS } from "@/lib/demo/tenancy-fixture";
import { messagesFor } from "@/i18n/layering";
import type { Conversation, Deal, Lead, Role, Task } from "@/lib/data/types";

export type Mode = "empty" | "demo";
export const state: { mode: Mode; role: Role; now: string } = { mode: "empty", role: "owner", now: "2026-11-27T06:00:00.000Z" };

/** A real-looking supabase source whose every table has zero rows (what the owner's purged database returns). */
export function emptySource(): DataSource {
  return {
    kind: "supabase", workspaceId: "ws-empty", notWired: ["privacyRequests"], now: () => state.now,
    team: async () => [], accounts: async () => [], account: async () => null, leads: async () => [], lead: async () => null,
    activities: async () => [], deals: async () => [], campaigns: async () => [], campaign: async () => null, campaignDays: async () => [],
    ga4: async () => ({ days: [], pages: [] }), tasks: async () => [], conversations: async () => [], integrations: async () => [],
    integration: async () => null, consent: async () => [], privacyRequests: async () => [], audit: async () => [], syncRuns: async () => [],
    aiSettings: async () => AI_OFF, holidays: async () => [],
  };
}

export function makeCtx() {
  const demo = state.mode === "demo";
  const ws = demo ? WORKSPACES[0] : activeFromRow({ workspace_id: "ws-empty", workspace_name: "Empty", workspace_slug: "empty", region_label: null, is_demo: false, tenant_id: "t-empty", tenant_name: "Empty Co", tenant_slug: "empty-co", branding: null, role: state.role, via_support_session: false, support_session_expires_at: null }).ws;
  const tenant = demo ? TENANTS[0] : activeFromRow({ workspace_id: "ws-empty", workspace_name: "Empty", workspace_slug: "empty", region_label: null, is_demo: false, tenant_id: "t-empty", tenant_name: "Empty Co", tenant_slug: "empty-co", branding: null, role: state.role, via_support_session: false, support_session_expires_at: null }).tenant;
  const cfg = resolveEffective(tenant.id, undefined);
  const ds = demo ? mockSource(datasetFor(WORKSPACES[0].dataset), ws.id) : emptySource();
  const session = { uid: "u-1", name: "Test User", email: "t@example.test", demo, platformAdmin: false, memberships: [{ ws: ws.id, role: state.role }], iat: Date.now() };
  const own = state.role === "sales_rep";
  const scope = {
    leads: (xs: Lead[]) => (own ? xs.filter((l) => l.ownerId === session.uid) : xs), deals: (xs: Deal[]) => (own ? xs.filter((d) => d.ownerId === session.uid) : xs),
    tasks: (xs: Task[]) => (own ? xs.filter((t) => t.ownerId === session.uid) : xs),
    conversations: (xs: Conversation[], leads: Lead[]) => (own ? xs.filter((c) => leads.find((l) => l.id === c.leadId)?.ownerId === session.uid) : xs),
  };
  return {
    session, active: { ws, tenant, role: state.role, support: null, viaSupport: false }, role: state.role, ds, cfg,
    stageOrder: { lead: stageList(cfg.stages.lead), deal: stageList(cfg.stages.deal) },
    slaHours: slaHoursFrom(cfg.data.businessHours), slaMins: Math.round(cfg.data.slaHours * 60), now: ds.now(), scope, masked: state.role === "viewer", support: null,
  };
}

/** What useSession() gives client components (the real provider needs the whole shell). */
export function makeShell() {
  const c = makeCtx();
  return {
    uid: c.session.uid, name: c.session.name, email: c.session.email, demo: c.session.demo, platformAdmin: false, role: c.role,
    ws: { id: c.active.ws.id, name: c.active.ws.name, region: c.active.ws.region },
    tenant: { id: c.active.tenant.id, name: c.active.tenant.name, product: c.active.tenant.product, hue: c.active.tenant.hue, monogram: "E", vertical: "legal", workspaceCount: 1, isPrimaryOwner: true, config: undefined, stageOrder: c.stageOrder },
    workspaces: [], support: null, objects: [],
  };
}

export const makePrincipal = () => systemPrincipal({ uid: "u-1", workspaceId: "ws-empty", role: state.role, tenantId: "empty-co", modulesOff: [], tenant: { status: "active" }, support: null });

export async function makeT(namespace: string) {
  const locale = "en" as const;
  return createTranslator({ locale, messages: messagesFor(locale), namespace } as never) as (key: string, values?: Record<string, string | number>) => string;
}

/** Resolve async server components in a tree (React's static renderer cannot await them), then render to HTML. */
async function resolve(node: ReactNode, depth = 0): Promise<ReactNode> {
  if (depth > 40 || node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return Promise.all(node.map((n) => resolve(n, depth + 1)));
  if (!isValidElement(node)) return node;
  const el = node as { type: unknown; props: Record<string, unknown> };
  if (typeof el.type === "function" && el.type.constructor.name === "AsyncFunction") return resolve(await (el.type as (p: unknown) => Promise<ReactNode>)(el.props), depth + 1);
  const props = el.props as { children?: ReactNode };
  if (props && props.children !== undefined) {
    const children = await resolve(props.children, depth + 1);
    return createElement(el.type as never, { ...el.props, children } as never);
  }
  return node;
}

export async function renderPage(Page: (p: never) => Promise<ReactNode> | ReactNode, props: Record<string, unknown> = {}): Promise<string> {
  const out = await Page({ params: Promise.resolve({}), searchParams: Promise.resolve({}), ...props } as never);
  return renderToStaticMarkup(await resolve(out) as ReactNode);
}

/** Text that must never reach a screen. */
export const BAD_TEXT = /NaN|Infinity|undefined|\[object Object\]|Invalid Date/;

/** A Supabase-shaped client whose every query resolves to zero rows (chainable and awaitable at any point, rpc included). */
export function emptyDb(): unknown {
  const result = { data: [], error: null, count: 0 };
  const chain: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === "then" ? (res: (v: unknown) => unknown) => res(result) : k === "single" || k === "maybeSingle" ? () => Promise.resolve({ data: null, error: null }) : chain),
    apply: () => chain,
  });
  return new Proxy({}, { get: (_t, k) => (k === "then" ? undefined : k === "auth" ? { getUser: async () => ({ data: { user: null } }) } : chain) });
}
