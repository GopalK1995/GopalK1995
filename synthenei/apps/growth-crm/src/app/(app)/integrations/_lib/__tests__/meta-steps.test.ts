import { describe, expect, it } from "vitest";
import { buildMetaConnectModel } from "../meta-steps";
import { makeT } from "../strings";
import type { MetaConnectView, MetaHealthView } from "../types";

const t = makeT("en");
const REQ = ["pages_show_list", "leads_retrieval", "instagram_basic"];
const conn = (o: Partial<MetaConnectView> = {}): MetaConnectView => ({ connected: true, needsReconnect: false, connectionId: "c1", pageName: "Sea View Resort", igUsername: "seaview", accounts: 2, posts: 14, lastOkRows: 31, ...o });
const health = (o: Partial<MetaHealthView> = {}): MetaHealthView => ({
  scopesGranted: 3, scopesRequested: 3, scopesMissing: [], scopesGrantedList: REQ, scopesRequestedList: REQ,
  expiresAt: "2027-01-10T00:00:00.000Z", neverExpires: false, daysLeft: 40, webhook: "unknown", lastOkAt: "2026-11-25T10:00:00.000Z", attention: false, ...o,
});
const build = (c: MetaConnectView, h: MetaHealthView | null, blocked: string | null = null) => buildMetaConnectModel({ c, h, t, connectBlocked: blocked });
const status = (m: ReturnType<typeof build>) => Object.fromEntries(m.steps.map((s) => [s.key, s.status]));

describe("Instagram and Facebook step list", () => {
  it("not connected: step 1 is the only thing to do, the rest wait", () => {
    const m = build(conn({ connected: false, pageName: null, igUsername: null, connectionId: null }), null);
    expect(status(m)).toEqual({ connect: "todo", assets: "blocked", webhooks: "pending", sync: "blocked" });
    expect(m.next.text).toMatch(/Connect Facebook/);
    expect(m.scopes).toEqual([]);
  });

  it("not connected and the viewer may not connect: says why instead of telling them to click", () => {
    const m = build(conn({ connected: false, pageName: null }), null, "Only the workspace Owner can change integrations.");
    expect(m.next.tone).toBe("warn");
    expect(m.next.text).toMatch(/Only the workspace Owner/);
  });

  it("connected without a Page: step 1 done, step 2 to do, sync blocked", () => {
    const m = build(conn({ pageName: null, igUsername: null }), health({ lastOkAt: null }));
    expect(status(m)).toMatchObject({ connect: "done", assets: "todo", sync: "blocked" });
    expect(m.next.text).toMatch(/Choose the Facebook Page/);
  });

  it("shows the chosen Page and Instagram names and the one-Page-per-workspace truth", () => {
    const m = build(conn(), health());
    const lines = m.steps[1].lines.map((l) => l.text);
    expect(lines).toContain("Facebook Page: Sea View Resort");
    expect(lines).toContain("Instagram: @seaview");
    expect(lines.join(" ")).toMatch(/One Page per workspace/);
    expect(lines.join(" ")).not.toMatch(/connecting again/i);
  });

  it("says when the Page has no linked Instagram account", () => {
    const m = build(conn({ igUsername: null }), health());
    expect(m.steps[1].lines.map((l) => l.text)).toContain("Instagram: no account linked to this Page");
  });

  it("webhooks are always 'pending platform setup' (AUD-065) and never show a URL or token", () => {
    const m = build(conn(), health({ webhook: "yes" }));
    const s3 = m.steps[2];
    expect(s3.status).toBe("pending");
    expect(s3.statusLabel).toBe("Pending platform setup");
    const text = s3.lines.map((l) => l.text).join(" ");
    expect(text).toMatch(/webhook URL and verify token will be shown here/);
    expect(text).toMatch(/subscribed/);
    expect(text).not.toMatch(/https?:\/\//);
  });

  it("a refused Page subscription is flagged on step 3", () => {
    const m = build(conn(), health({ webhook: "no" }));
    expect(m.steps[2].lines.some((l) => l.bad && /refused/.test(l.text))).toBe(true);
  });

  it("first sync: done with the last successful time and counts", () => {
    const m = build(conn(), health());
    const s4 = m.steps[3];
    expect(s4.status).toBe("done");
    const text = s4.lines.map((l) => l.text).join(" | ");
    expect(text).toMatch(/Last successful sync 25 Nov/);
    expect(text).toMatch(/2 accounts and 14 posts tracked/);
    expect(text).toMatch(/Last run imported 31 rows/);
    expect(m.next.tone).toBe("ok");
  });

  it("first sync not yet happened: to do, with a next line that says wait or run it", () => {
    const m = build(conn(), health({ lastOkAt: null }));
    expect(m.steps[3].status).toBe("todo");
    expect(m.next.text).toMatch(/first sync/);
  });

  it("missing scopes: step 1 needs attention, the missing names are listed and the next line names them", () => {
    const m = build(conn(), health({ scopesGranted: 2, scopesMissing: ["leads_retrieval"], scopesGrantedList: ["pages_show_list", "instagram_basic"] }));
    expect(m.steps[0].status).toBe("attention");
    expect(m.scopes.find((s) => s.name === "leads_retrieval")).toMatchObject({ state: "missing", label: "missing" });
    expect(m.scopes.find((s) => s.name === "instagram_basic")).toMatchObject({ state: "granted" });
    expect(m.next.text).toMatch(/leads_retrieval/);
    expect(m.steps[0].lines.map((l) => l.text).join(" ")).toMatch(/2 of 3 granted/);
  });

  it("scopes not checked yet are 'not checked', never 'granted'", () => {
    const m = build(conn(), health({ scopesGranted: null, scopesGrantedList: [] }));
    expect(m.scopes.every((s) => s.state === "unknown")).toBe(true);
  });

  it("token expiry date and days left are shown; inside a week it warns", () => {
    const ok = build(conn(), health());
    expect(ok.steps[0].lines.map((l) => l.text).join(" ")).toMatch(/Access expires 10 Jan 2027 \(40 days left\)/);
    const soon = build(conn(), health({ daysLeft: 3 }));
    expect(soon.next.tone).toBe("warn");
    expect(soon.next.text).toMatch(/expires in 3 days/);
  });

  it("an expired token or a connection that needs attention asks for Reconnect", () => {
    const expired = build(conn(), health({ daysLeft: -2 }));
    expect(expired.steps[0].status).toBe("attention");
    expect(expired.next.text).toMatch(/Reconnect/);
    const lapsed = build(conn({ needsReconnect: true }), health());
    expect(lapsed.steps[0].status).toBe("attention");
  });

  it("a token that never expires says so", () => {
    const m = build(conn(), health({ expiresAt: null, daysLeft: null, neverExpires: true }));
    expect(m.steps[0].lines.map((l) => l.text)).toContain("Access does not expire");
  });
});
