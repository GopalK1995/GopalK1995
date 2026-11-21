// Channel picker, test alert, webhook (revocation) handling, OAuth spec, alert routing.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/service", () => ({ serviceDb: () => ({}) }));
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAuthorizeUrl } from "../../core/oauth";
import { loadSecrets } from "../../core/secrets";
import { ALL_CONNECTORS } from "../../all";
import { listSlackChannels, selectSlackChannel, sendSlackTest } from "../assets";
import { mockFor } from "../config";
import { parseSlackEvent, setSlackRuntimeFactory, slackConnector } from "../connector";
import { SLACK_ENV, WEBHOOK_KEYS } from "../constants";
import { routeSlackAlerts, setSlackJobDeps } from "../jobs";
import { ACTOR, OTHER, addConnection, setup, slackFetch, type Setup } from "./helpers";

let s: Setup;
beforeEach(() => { s = setup(); });

describe("channel picker", () => {
  it("lists names, ids and privacy only", async () => {
    const c = await addConnection(s, { secrets: { channel_id: "" } });
    const r = await listSlackChannels(s.deps, ACTOR, c.id);
    expect(r.ok && r.value.map((x) => x.name)).toEqual(["sales-alerts", "general", "leadership"]);
    expect(JSON.stringify(r)).not.toMatch(/token|secret/i);
  });
  it("selecting stores the channel, switches and team in the Vault bundle and the signing secret in the webhook bundle, audited", async () => {
    const c = await addConnection(s, { secrets: { channel_id: "" } });
    const r = await selectSlackChannel(s.deps, ACTOR, c.id, { channelId: "GMOCK0003", alerts: ["new_enquiry", "sync_failed"], includeNames: true, locale: "ta" });
    expect(r).toEqual({ ok: true, value: { channelName: "leadership", teamName: "Sample workspace", alerts: ["new_enquiry", "sync_failed"] } });
    const row = s.store.conns.get(c.id)!;
    const bundle = await loadSecrets(s.vault, row);
    expect(bundle).toMatchObject({ channel_id: "GMOCK0003", channel_name: "leadership", team_id: "TMOCK0001", alerts: "new_enquiry,sync_failed", include_names: "1", locale: "ta" });
    expect(JSON.parse(s.vault.secrets.get(row.webhookSecretId!)!)).toEqual({ [WEBHOOK_KEYS.signingSecret]: "signing-secret-for-tests" });
    expect(s.audits).toHaveLength(1);
    expect(s.audits[0].action).toBe("slack.channel_selected");
    expect(JSON.stringify(s.audits[0])).not.toMatch(/signing-secret|access_token/);
  });
  it("defaults: all alerts on, names off, English", async () => {
    const c = await addConnection(s, { secrets: { channel_id: "", alerts: undefined as unknown as string } });
    const bundle0 = await loadSecrets(s.vault, s.store.conns.get(c.id)!);
    delete (bundle0 as Record<string, string>).alerts;
    const r = await selectSlackChannel(s.deps, ACTOR, c.id, { channelId: "CMOCK0001" });
    expect(r.ok && r.value.alerts).toEqual(["new_enquiry", "sla_breached", "advance_received", "sync_failed"]);
    expect(await loadSecrets(s.vault, s.store.conns.get(c.id)!)).toMatchObject({ include_names: "0", locale: "en" });
  });
  it("only a channel Slack reports for this token can be chosen", async () => {
    const c = await addConnection(s);
    expect(await selectSlackChannel(s.deps, ACTOR, c.id, { channelId: "CSOMEONEELSE" })).toEqual({ ok: false, code: "channel_not_available" });
    expect(s.audits).toHaveLength(0);
  });
  it("joins a public channel the bot is not in, so the first alert cannot fail on membership", async () => {
    const c = await addConnection(s);
    const r = await selectSlackChannel(s.deps, ACTOR, c.id, { channelId: "CMOCK0002" });
    expect(r.ok).toBe(true);
    expect(mockFor(c.id).posted).toHaveLength(0);
    expect((await mockFor(c.id).listChannels()).channels.find((x) => x.id === "CMOCK0002")?.isMember).toBe(true);
  });
  it("a join Slack refuses is reported, not swallowed", async () => {
    const f = slackFetch((m) => (m === "conversations.list" ? { ok: true, channels: [{ id: "C9", name: "locked", is_member: false }] } : m === "conversations.join" ? { ok: false, error: "restricted_action" } : { ok: true }));
    s = setup({ fetchImpl: f });
    const c = await addConnection(s, { secrets: { access_token: "xoxb-t" } });
    expect(await selectSlackChannel(s.deps, ACTOR, c.id, { channelId: "C9" }, f)).toEqual({ ok: false, code: "cannot_join" });
  });
  it("another workspace or tenant cannot see or change this connection", async () => {
    const c = await addConnection(s);
    expect(await listSlackChannels(s.deps, OTHER, c.id)).toEqual({ ok: false, code: "not_found" });
    expect(await selectSlackChannel(s.deps, OTHER, c.id, { channelId: "CMOCK0001" })).toEqual({ ok: false, code: "not_found" });
    expect(await sendSlackTest(s.deps, OTHER, c.id)).toEqual({ ok: false, code: "not_found" });
    expect(await selectSlackChannel(s.deps, { ...ACTOR, tenantId: "t-2" }, c.id, { channelId: "CMOCK0001" })).toEqual({ ok: false, code: "not_found" });
  });
  it("a disconnected connection cannot be configured", async () => {
    const c = await addConnection(s, { status: "disconnected" });
    expect(await selectSlackChannel(s.deps, ACTOR, c.id, { channelId: "CMOCK0001" })).toEqual({ ok: false, code: "not_connected" });
  });
  it("audit or nothing: a failing audit stops the action with an error", async () => {
    const m = setup();
    const c = await addConnection(m);
    const deps = { ...m.deps, audit: async () => { throw new Error("db down"); } };
    expect(await selectSlackChannel(deps, ACTOR, c.id, { channelId: "CMOCK0001" })).toEqual({ ok: false, code: "audit_failed" });
  });
  it("a revoked token during the pick flips nothing silently: the caller gets token_rejected", async () => {
    const c = await addConnection(s);
    mockFor(c.id).revoke();
    expect(await selectSlackChannel(s.deps, ACTOR, c.id, { channelId: "CMOCK0001" })).toEqual({ ok: false, code: "token_rejected" });
  });
  it("picking a working channel heals a connection parked for a lost channel", async () => {
    const c = await addConnection(s, { status: "needs_attention" });
    s.store.conns.get(c.id)!.lastError = "Slack cannot post to the chosen channel";
    expect((await selectSlackChannel(s.deps, ACTOR, c.id, { channelId: "CMOCK0001" })).ok).toBe(true);
    expect(s.store.conns.get(c.id)).toMatchObject({ status: "sandbox", lastError: null });
  });
  it("test alert posts to the chosen channel; no channel, or a dead token, is reported", async () => {
    const c = await addConnection(s);
    expect(await sendSlackTest(s.deps, ACTOR, c.id)).toEqual({ ok: true, value: { sent: true } });
    expect(mockFor(c.id).posted[0].text).toBe("Test alert from the CRM");
    const none = await addConnection(s, { secrets: { channel_id: "" } });
    expect(await sendSlackTest(s.deps, ACTOR, none.id)).toEqual({ ok: false, code: "no_channel" });
    mockFor(c.id).revoke();
    expect(await sendSlackTest(s.deps, ACTOR, c.id)).toEqual({ ok: false, code: "token_rejected" });
    expect(s.store.conns.get(c.id)!.status).toBe("needs_attention");
  });
});

describe("connector definition", () => {
  it("OAuth: Slack v2 bot scopes as a comma list, no user scopes, state carried", () => {
    const u = new URL(buildAuthorizeUrl(slackConnector.oauth!, { clientId: "cid", redirectUri: "https://crm.example.test/api/oauth/slack/callback", state: "st" }));
    expect(u.origin + u.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(u.searchParams.get("scope")).toBe("chat:write,channels:read,groups:read,channels:join");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.has("user_scope")).toBe(false);
    expect(slackConnector.oauth).toMatchObject({ clientIdEnv: SLACK_ENV.clientId, clientSecretEnv: SLACK_ENV.clientSecret, pkce: false });
  });
  it("is registered, with webhook scheme slack and no streams (alerts are event driven)", async () => {
    expect(ALL_CONNECTORS.map((c) => c.id)).toEqual(expect.arrayContaining(["slack", "zapier", "make"]));
    const { schemeFor } = await import("../../verify");
    expect(schemeFor("slack")).toBe("slack");
    expect(slackConnector.streams).toEqual([]);
  });
  it("only revocation events matter; junk and other events are ignored", () => {
    expect(parseSlackEvent(JSON.stringify({ type: "event_callback", team_id: "T1", event: { type: "tokens_revoked" } }))).toEqual([{ kind: "revoked", teamId: "T1", event: "tokens_revoked" }]);
    expect(parseSlackEvent(JSON.stringify({ type: "event_callback", team_id: "T1", event: { type: "app_uninstalled" } }))).toEqual([{ kind: "revoked", teamId: "T1", event: "app_uninstalled" }]);
    expect(parseSlackEvent(JSON.stringify({ type: "event_callback", team_id: "T1", event: { type: "message" } }))).toEqual([{ kind: "ignored" }]);
    expect(parseSlackEvent("not json")).toEqual([]);
    expect(parseSlackEvent(JSON.stringify({ type: "url_verification", challenge: "x" }))).toEqual([{ kind: "ignored" }]);
  });
  it("a revocation event for THIS team parks the connection; the same signed body sent to another team's connection does nothing", async () => {
    setSlackRuntimeFactory(async () => ({ deps: s.sdeps }));
    try {
      const mine = await addConnection(s, { secrets: { team_id: "T1" } });
      const theirs = await addConnection(s, { ws: "w-2", tenant: "t-2", secrets: { team_id: "T2" } });
      const evt = (await slackConnector.webhook!.verify({ rawBody: JSON.stringify({ type: "event_callback", team_id: "T1", event: { type: "tokens_revoked" } }), headers: {} }, {}))[0];
      const ctx = (conn: typeof mine) => ({ conn, secrets: async () => loadSecrets(s.vault, conn) }) as never;
      await slackConnector.webhook!.handle(ctx(theirs), evt);
      expect(s.store.conns.get(theirs.id)!.status).toBe("sandbox");
      await slackConnector.webhook!.handle(ctx(mine), evt);
      expect(s.store.conns.get(mine.id)).toMatchObject({ status: "needs_attention" });
      expect(s.store.conns.get(mine.id)!.lastError).toMatch(/revoked/i);
    } finally { setSlackRuntimeFactory(null); }
  });
});

describe("alert routing (event fan-out)", () => {
  const ev = (type: string, ws = "w-1") => ({ id: "e1", type, tenantId: "t-1", workspaceId: ws, objectType: "lead", objectId: "L1", data: { connector: "meta-ads", stream: "insights", reason: "boom", secret: "nope" } });
  beforeEach(() => setSlackJobDeps(() => s.sdeps));
  it("routes only alert events, only to this workspace's runnable Slack connections", async () => {
    const mine = await addConnection(s, { ws: "w-1" });
    await addConnection(s, { ws: "w-2", tenant: "t-2" });
    await addConnection(s, { ws: "w-1", status: "needs_attention" });
    const out = await routeSlackAlerts(ev("lead.created"), {} as SupabaseClient);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ queue: "connector_sync", body: { kind: "slack.alert", tenant_id: "t-1", payload: { connection_id: mine.id, workspace_id: "w-1", dedupe: `sl:e1:${mine.id}` } } });
    expect(await routeSlackAlerts(ev("lead.updated"), {} as SupabaseClient)).toEqual([]);
    expect(await routeSlackAlerts(ev("lead.created", "w-3"), {} as SupabaseClient)).toEqual([]);
  });
  it("copies only whitelisted, short, non-PII facts from the event", async () => {
    await addConnection(s);
    const [m] = await routeSlackAlerts(ev("connector.sync.failed"), {} as SupabaseClient);
    expect((m.body.payload as { data: object }).data).toEqual({ connector: "meta-ads", stream: "insights", reason: "boom" });
    expect(JSON.stringify(m)).not.toContain("nope");
  });
  it("ignores connections of other connectors", async () => {
    const c = await addConnection(s);
    s.store.conns.get(c.id)!.connectorId = "razorpay";
    expect(await routeSlackAlerts(ev("lead.created"), {} as SupabaseClient)).toEqual([]);
  });
});
