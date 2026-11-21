// Alert delivery: switches, isolation, revoked token, channel loss, rate cap, transient failures.
import { beforeEach, describe, expect, it } from "vitest";
import { mockFor } from "../config";
import { deliverAlertDetailed, type AlertJob } from "../deliver";
import { addConnection, setup, slackFetch, type Setup } from "./helpers";

const job = (c: { id: string }, over: Partial<AlertJob> = {}): AlertJob => ({ connection_id: c.id, workspace_id: "w-1", type: "lead.created", event_id: "e1", object_type: "lead", object_id: "L1", ...over });
let s: Setup;
beforeEach(() => { s = setup(); s.subjects.rows.set("lead:L1", { workspaceId: "w-1", name: "Asha Rao", source: "website", city: "Madurai", link: { type: "lead", id: "L1" } }); });

describe("posting", () => {
  it("posts a new-enquiry alert to the chosen channel, without the lead's name by default", async () => {
    const c = await addConnection(s);
    expect(await deliverAlertDetailed(s.sdeps, job(c))).toBe("posted");
    const posted = mockFor(c.id).posted;
    expect(posted).toHaveLength(1);
    expect(posted[0].channel).toBe("CMOCK0001");
    expect(JSON.stringify(posted[0])).not.toContain("Asha");
    expect(s.subjects.calls[0].withName).toBe(false);
    expect(JSON.stringify(posted[0])).toContain("https://crm.example.test/leads/L1");
  });
  it("includes the name when the connection opted in", async () => {
    const c = await addConnection(s, { secrets: { include_names: "1" } });
    await deliverAlertDetailed(s.sdeps, job(c));
    expect(mockFor(c.id).posted[0].text).toBe("New enquiry: Asha Rao");
  });
  it("a switched-off alert, an unknown type and a missing channel post nothing", async () => {
    const off = await addConnection(s, { secrets: { alerts: "sync_failed" } });
    expect(await deliverAlertDetailed(s.sdeps, job(off))).toBe("skipped");
    const none = await addConnection(s, { secrets: { channel_id: "" } });
    expect(await deliverAlertDetailed(s.sdeps, job(none))).toBe("skipped");
    const ok = await addConnection(s);
    expect(await deliverAlertDetailed(s.sdeps, job(ok, { type: "lead.updated" }))).toBe("skipped");
    expect(mockFor(off.id).posted.length + mockFor(none.id).posted.length + mockFor(ok.id).posted.length).toBe(0);
  });
  it("a disconnected or needs_attention connection posts nothing", async () => {
    for (const status of ["disconnected", "needs_attention", "error"] as const) {
      const c = await addConnection(s, { status });
      expect(await deliverAlertDetailed(s.sdeps, job(c))).toBe("skipped");
      expect(mockFor(c.id).posted).toHaveLength(0);
    }
  });
  it("sync_failed alerts do not echo this connection's own failures back into its channel", async () => {
    const c = await addConnection(s);
    expect(await deliverAlertDetailed(s.sdeps, job(c, { type: "connector.sync.failed", object_type: "integration", object_id: c.id, data: { connector: "slack" } }))).toBe("skipped");
    expect(await deliverAlertDetailed(s.sdeps, job(c, { type: "connector.sync.failed", object_type: "integration", object_id: "other", data: { connector: "meta-ads", stream: "insights" } }))).toBe("posted");
    expect(mockFor(c.id).posted[0].text).toBe("Sync failed: meta-ads");
  });
  it("is capped per connection: a flood is dropped, not sent", async () => {
    const c = await addConnection(s);
    s.allowed.v = false;
    expect(await deliverAlertDetailed(s.sdeps, job(c))).toBe("dropped");
    expect(mockFor(c.id).posted).toHaveLength(0);
  });
});

describe("tenant isolation", () => {
  it("a job for another workspace's event never uses this connection's token or channel", async () => {
    const mine = await addConnection(s, { ws: "w-1", tenant: "t-1" });
    expect(await deliverAlertDetailed(s.sdeps, job(mine, { workspace_id: "w-2" }))).toBe("skipped");
    expect(mockFor(mine.id).posted).toHaveLength(0);
  });
  it("the subject lookup is scoped to the connection's workspace", async () => {
    s.subjects.rows.set("lead:LX", { workspaceId: "w-2", name: "Other Tenant Person", source: "meta" });
    const c = await addConnection(s, { secrets: { include_names: "1" } });
    await deliverAlertDetailed(s.sdeps, job(c, { object_id: "LX" }));
    expect(JSON.stringify(mockFor(c.id).posted)).not.toContain("Other Tenant");
  });
  it("a connection id that belongs to a different connector is ignored", async () => {
    const c = await addConnection(s);
    s.store.conns.get(c.id)!.connectorId = "razorpay";
    expect(await deliverAlertDetailed(s.sdeps, job(c))).toBe("skipped");
  });
  it("two workspaces post to their own channels with their own tokens", async () => {
    const a = await addConnection(s, { ws: "w-1", secrets: { channel_id: "CMOCK0001" } });
    const b = await addConnection(s, { ws: "w-2", tenant: "t-2", secrets: { channel_id: "GMOCK0003" } });
    await deliverAlertDetailed(s.sdeps, job(a));
    await deliverAlertDetailed(s.sdeps, job(b, { workspace_id: "w-2" }));
    expect(mockFor(a.id).posted.map((p) => p.channel)).toEqual(["CMOCK0001"]);
    expect(mockFor(b.id).posted.map((p) => p.channel)).toEqual(["GMOCK0003"]);
  });
});

describe("failures", () => {
  it("a revoked token flips the connection to needs_attention with a readable reason, tells the bus, and stops further posts", async () => {
    const c = await addConnection(s);
    mockFor(c.id).revoke();
    expect(await deliverAlertDetailed(s.sdeps, job(c))).toBe("needs_attention");
    const row = s.store.conns.get(c.id)!;
    expect(row.status).toBe("needs_attention");
    expect(row.lastError).toMatch(/reconnect Slack/i);
    expect(row.lastError).not.toMatch(/xox|secret/i);
    expect(s.emitted).toEqual([{ type: "connector.sync.failed", workspaceId: "w-1", objectId: c.id, data: { connector: "slack", reason: "token_revoked" } }]);
    expect(await deliverAlertDetailed(s.sdeps, job(c, { event_id: "e2" }))).toBe("skipped");
  });
  it("real gateway: Slack's ok:false token_revoked is a credential failure, with the bearer token sent and never stored in the error", async () => {
    const f = slackFetch(() => ({ ok: false, error: "token_revoked" }));
    s = setup({ fetchImpl: f });
    s.subjects.rows.set("lead:L1", { workspaceId: "w-1", source: "website" });
    const c = await addConnection(s, { secrets: { access_token: "xoxb-real-looking-token" } });
    expect(await deliverAlertDetailed(s.sdeps, job(c))).toBe("needs_attention");
    expect(f.calls[0]).toMatchObject({ method: "chat.postMessage", auth: "Bearer xoxb-real-looking-token" });
    expect(s.store.conns.get(c.id)!.lastError).not.toContain("xoxb");
  });
  it("account_inactive and invalid_auth are also token failures", async () => {
    for (const error of ["account_inactive", "invalid_auth", "not_authed"]) {
      s = setup({ fetchImpl: slackFetch(() => ({ ok: false, error })) });
      const c = await addConnection(s, { secrets: { access_token: "xoxb-t" } });
      expect(await deliverAlertDetailed(s.sdeps, job(c))).toBe("needs_attention");
    }
  });
  it("a deleted or archived channel parks the connection for a new pick", async () => {
    for (const error of ["channel_not_found", "is_archived"]) {
      s = setup({ fetchImpl: slackFetch(() => ({ ok: false, error })) });
      const c = await addConnection(s, { secrets: { access_token: "xoxb-t" } });
      expect(await deliverAlertDetailed(s.sdeps, job(c))).toBe("needs_attention");
      expect(s.store.conns.get(c.id)!.lastError).toMatch(/pick the channel again/i);
    }
  });
  it("not_in_channel: the bot rejoins once and retries the post", async () => {
    let posts = 0;
    const f = slackFetch((m) => (m === "chat.postMessage" ? (++posts === 1 ? { ok: false, error: "not_in_channel" } : { ok: true, ts: "1.2" }) : { ok: true }));
    s = setup({ fetchImpl: f });
    const c = await addConnection(s, { secrets: { access_token: "xoxb-t" } });
    expect(await deliverAlertDetailed(s.sdeps, job(c))).toBe("posted");
    expect(f.calls.map((x) => x.method)).toEqual(["chat.postMessage", "conversations.join", "chat.postMessage"]);
  });
  it("Slack rate limiting is a retry, not a failure of the connection", async () => {
    s = setup({ fetchImpl: slackFetch(() => ({ ok: false, error: "ratelimited" })) });
    const c = await addConnection(s, { secrets: { access_token: "xoxb-t" } });
    expect(await deliverAlertDetailed(s.sdeps, job(c))).toBe("retry");
    expect(s.store.conns.get(c.id)!.status).toBe("sandbox");
  });
  it("the mock token is refused in production", async () => {
    s = setup({ env: { APP_ENV: "production" } });
    const c = await addConnection(s);
    expect(await deliverAlertDetailed(s.sdeps, job(c))).toBe("needs_attention");
  });
});
