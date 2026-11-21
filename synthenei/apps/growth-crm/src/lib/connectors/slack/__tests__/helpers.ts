// Shared fakes for the Slack tests: the framework's in-memory store + Vault, a Slack subject store, and scripted Slack HTTP.
import { FakeStore, FakeVault, makeDeps } from "../../core/__tests__/fakes";
import type { ConnectionRow, ConnectionSecrets } from "../../core/types";
import { SLACK_MOCK_TOKEN } from "../constants";
import { resetMockGateways } from "../config";
import type { Subject } from "../alerts";
import type { SlackDeps, SlackStore } from "../store";

export const ENV = { APP_ENV: "test", APP_BASE_URL: "https://crm.example.test", SLACK_SIGNING_SECRET: "signing-secret-for-tests" };
export const ACTOR = { uid: "u-1", tenantId: "t-1", workspaceId: "w-1" };
export const OTHER = { uid: "u-9", tenantId: "t-2", workspaceId: "w-2" };

export class FakeSubjects implements SlackStore {
  rows = new Map<string, Subject & { workspaceId: string }>();
  calls: { type: string; id: string; withName: boolean }[] = [];
  async describe(workspaceId: string, type: string, id: string, withName: boolean) {
    this.calls.push({ type, id, withName });
    const r = this.rows.get(`${type}:${id}`);
    if (!r || r.workspaceId !== workspaceId) return null;
    const { workspaceId: _w, ...rest } = r; void _w;
    return withName ? rest : { ...rest, name: null };
  }
}

export function setup(over: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {}) {
  resetMockGateways();
  const env = { ...ENV, ...(over.env ?? {}) };
  const m = makeDeps({ env, fetchImpl: over.fetchImpl });
  m.store.availability.slack = { mode: "sandbox", gateStatus: "ready" };
  const subjects = new FakeSubjects();
  const emitted: { type: string; workspaceId: string; objectId: string; data: Record<string, unknown> }[] = [];
  const allowed = { v: true };
  const sdeps: SlackDeps = {
    store: subjects, core: m.store, vault: m.vault, log: { info() {}, warn() {}, error() {} }, now: () => new Date("2026-11-09T05:00:00Z"), env,
    rate: async () => allowed.v, fetchImpl: over.fetchImpl, emit: async (e) => { emitted.push(e); },
  };
  return { ...m, env, subjects, sdeps, emitted, allowed };
}
export type Setup = ReturnType<typeof setup>;

/** A connected Slack connection holding a bundle in the Vault. */
export async function addConnection(s: { store: FakeStore; vault: FakeVault }, o: { id?: string; ws?: string; tenant?: string; status?: ConnectionRow["status"]; secrets?: ConnectionSecrets } = {}): Promise<ConnectionRow> {
  const bundle: ConnectionSecrets = { access_token: SLACK_MOCK_TOKEN, channel_id: "CMOCK0001", channel_name: "sales-alerts", team_id: "TMOCK0001", alerts: "new_enquiry,sla_breached,advance_received,sync_failed", ...(o.secrets ?? {}) };
  const secretId = await s.vault.putSecret("x", JSON.stringify(bundle));
  const c: ConnectionRow = {
    id: o.id ?? `slack-${s.store.conns.size + 1}`, tenantId: o.tenant ?? "t-1", workspaceId: o.ws ?? "w-1", connectorId: "slack", mode: "sandbox", status: o.status ?? "sandbox", settings: {},
    credentialSecretId: secretId, webhookSecretId: null, tokenExpiresAt: null,
  };
  s.store.conns.set(c.id, c);
  return c;
}

/** Scripted Slack Web API over fetch: handler gets (method name, url, body) and returns the Slack envelope. */
export function slackFetch(handler: (method: string, url: URL, body: Record<string, unknown> | null) => Record<string, unknown>): typeof fetch & { calls: { method: string; auth: string | null; body: Record<string, unknown> | null }[] } {
  const calls: { method: string; auth: string | null; body: Record<string, unknown> | null }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = url.pathname.split("/").pop() ?? "";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, auth: (init?.headers as Record<string, string> | undefined)?.authorization ?? null, body });
    return new Response(JSON.stringify(handler(method, url, body)), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch & { calls: typeof calls };
  f.calls = calls;
  return f;
}
