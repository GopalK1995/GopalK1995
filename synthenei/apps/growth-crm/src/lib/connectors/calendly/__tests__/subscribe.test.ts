import { describe, expect, it } from "vitest";
import { calcomBase, subscribeCalcom, unsubscribeCalcom } from "../../calcom/api";
import { calendlyBase, subscribeCalendly, whoAmI } from "../api";
import { CredentialError } from "../../core/types";
import { saveState, stateOf, subscriptionState, webhookUrlFor, newSigningKey, type VendorFetch, type VendorReply } from "../subscribe";
import en from "../../../../../messages/en/calendly.json";
import ta from "../../../../../messages/ta/calendly.json";

const URL_ = "https://app.test/api/hooks/calendly/conn-1";
const ME: VendorReply = { status: 200, body: { resource: { uri: "https://api.calendly.com/users/U1", current_organization: "https://api.calendly.com/organizations/O1", name: "A", email: "a@b.test" } } };
const script = (...replies: ((m: string, u: string, b?: unknown) => VendorReply)[]) => {
  const calls: { m: string; u: string; h: Record<string, string>; b?: unknown }[] = [];
  const call: VendorFetch = async (m, u, h, b) => { calls.push({ m, u, h, b }); const r = replies.shift(); if (!r) throw new Error("unscripted call"); return r(m, u, b); };
  return { call, calls };
};
const secrets = { access_token: "tok", signing_key: "sign-key-0123456789abcdef" };

describe("Calendly subscribe", () => {
  it("subscribes at organisation scope with our signing key and the two events", async () => {
    const s = script(() => ME, () => ({ status: 201, body: { resource: { uri: "https://api.calendly.com/webhook_subscriptions/WH1" } } }));
    const out = await subscribeCalendly({ call: s.call, apiBase: "https://x.test", secrets, webhookUrl: URL_ });
    expect(out).toMatchObject({ code: "subscribed", id: "WH1", messageKey: "state_subscribed" });
    expect(s.calls[1].b).toMatchObject({ url: URL_, events: ["invitee.created", "invitee.canceled"], scope: "organization", signing_key: secrets.signing_key, organization: "https://api.calendly.com/organizations/O1" });
    expect(s.calls[1].h.authorization).toBe("Bearer tok");
  });
  it("a free plan (403 asking to upgrade) is the needs_paid_plan state, not a credential error", async () => {
    const s = script(() => ME, () => ({ status: 403, body: { title: "Permission Denied", message: "Please upgrade your Calendly account to Standard or higher" } }));
    expect(await subscribeCalendly({ call: s.call, apiBase: "https://x.test", secrets, webhookUrl: URL_ })).toMatchObject({ code: "needs_paid_plan", messageKey: "state_needs_paid_plan" });
    expect(s.calls).toHaveLength(2);   // no user-scope retry: the plan is the blocker
  });
  it("a non-admin (403 permission) falls back to user scope and says so", async () => {
    const s = script(() => ME, () => ({ status: 403, body: { title: "Permission Denied", message: "You do not have permission" } }), () => ({ status: 201, body: { resource: { uri: "https://api.calendly.com/webhook_subscriptions/WH2" } } }));
    expect(await subscribeCalendly({ call: s.call, apiBase: "https://x.test", secrets, webhookUrl: URL_ })).toMatchObject({ code: "user_scope", id: "WH2" });
    expect(s.calls[2].b).toMatchObject({ scope: "user", user: "https://api.calendly.com/users/U1" });
  });
  it("409 (already subscribed to this URL) removes ours and re-creates it", async () => {
    const s = script(() => ME, () => ({ status: 409, body: {} }),
      () => ({ status: 200, body: { collection: [{ uri: "https://api.calendly.com/webhook_subscriptions/OLD", callback_url: URL_ }, { uri: "https://api.calendly.com/webhook_subscriptions/OTHER", callback_url: "https://elsewhere.test/h" }] } }),
      () => ({ status: 204, body: null }), () => ({ status: 201, body: { resource: { uri: "https://api.calendly.com/webhook_subscriptions/NEW" } } }));
    expect(await subscribeCalendly({ call: s.call, apiBase: "https://x.test", secrets, webhookUrl: URL_ })).toMatchObject({ code: "subscribed", id: "NEW" });
    expect(s.calls.filter((c) => c.m === "DELETE").map((c) => c.u)).toEqual(["https://x.test/webhook_subscriptions/OLD"]);
  });
  it("a refused token (401) is needs_attention; a missing signing key never calls the vendor; a 500 is error; a thrown network error is error", async () => {
    expect((await subscribeCalendly({ call: script(() => ({ status: 401, body: null })).call, apiBase: "x", secrets, webhookUrl: URL_ })).code).toBe("needs_attention");
    const none = script();
    expect((await subscribeCalendly({ call: none.call, apiBase: "x", secrets: { access_token: "t" }, webhookUrl: URL_ })).code).toBe("needs_attention");
    expect(none.calls).toHaveLength(0);
    expect((await subscribeCalendly({ call: script(() => ME, () => ({ status: 500, body: null })).call, apiBase: "x", secrets, webhookUrl: URL_ })).code).toBe("error");
    expect((await subscribeCalendly({ call: async () => { throw new Error("net"); }, apiBase: "x", secrets, webhookUrl: URL_ })).code).toBe("error");
  });
  it("whoAmI throws CredentialError on 401 and when the token is missing", async () => {
    await expect(whoAmI(script(() => ({ status: 401, body: null })).call, "x", secrets)).rejects.toBeInstanceOf(CredentialError);
    await expect(whoAmI(script().call, "x", {})).rejects.toBeInstanceOf(CredentialError);
  });
  it("API base comes from env with the vendor default", () => {
    expect(calendlyBase({})).toBe("https://api.calendly.com");
    expect(calendlyBase({ CALENDLY_API_BASE: "https://stub.test/" })).toBe("https://stub.test");
    expect(calcomBase({})).toBe("https://api.cal.com");
    expect(calcomBase({ CALCOM_API_BASE: "https://cal.self-hosted.test" })).toBe("https://cal.self-hosted.test");
  });
});

describe("Cal.com subscribe", () => {
  const cs = { api_key: "cal_live_x", webhook_secret: "hook-secret-0123456789abcd" };
  it("replaces earlier subscriptions to our URL, then creates one with the three triggers and our secret", async () => {
    const u = "https://app.test/api/hooks/cal-com/conn-1";
    const s = script(() => ({ status: 200, body: { data: { id: 1, email: "a@b.test" } } }),
      () => ({ status: 200, body: { data: [{ id: "old", subscriberUrl: u }, { id: "other", subscriberUrl: "https://elsewhere.test" }] } }),
      () => ({ status: 200, body: {} }), () => ({ status: 201, body: { data: { id: "w9" } } }));
    expect(await subscribeCalcom({ call: s.call, apiBase: "https://c.test", secrets: cs, webhookUrl: u })).toMatchObject({ code: "subscribed", id: "w9" });
    expect(s.calls[2]).toMatchObject({ m: "DELETE", u: "https://c.test/v2/webhooks/old" });
    expect(s.calls[3].b).toEqual({ subscriberUrl: u, triggers: ["BOOKING_CREATED", "BOOKING_CANCELLED", "BOOKING_RESCHEDULED"], active: true, secret: cs.webhook_secret });
    expect(s.calls[3].h.authorization).toBe("Bearer cal_live_x");
  });
  it("a refused key is needs_attention; unsubscribe tolerates an already-gone webhook", async () => {
    expect((await subscribeCalcom({ call: script(() => ({ status: 401, body: null })).call, apiBase: "x", secrets: cs, webhookUrl: "u" })).code).toBe("needs_attention");
    expect(await unsubscribeCalcom({ call: script(() => ({ status: 404, body: null })).call, apiBase: "x", secrets: cs, id: "w9" })).toBe(true);
    expect(await unsubscribeCalcom({ call: script(() => ({ status: 500, body: null })).call, apiBase: "x", secrets: cs, id: "w9" })).toBe(false);
  });
});

describe("UI state", () => {
  it("every state code has an English and a Tamil string, and an unknown or missing health reads as not_subscribed", () => {
    for (const code of ["not_subscribed", "subscribed", "needs_paid_plan", "user_scope", "needs_attention", "error"] as const) {
      const k = stateOf(code).messageKey;
      expect((en as Record<string, string>)[k]).toBeTruthy();
      expect((ta as Record<string, string>)[k]).toBeTruthy();
    }
    for (const h of [null, undefined, {}, { booking_webhook: { state: "weird" } }, "x"]) expect(subscriptionState(h).code).toBe("not_subscribed");
    expect(subscriptionState({ booking_webhook: { state: "needs_paid_plan", at: "t" } })).toMatchObject({ code: "needs_paid_plan", at: "t" });
  });
  it("English and Tamil files carry the same keys", () => { expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort()); });
  it("saveState stores code/id/time (never a token) and flags needs_attention", async () => {
    const patches: unknown[] = [];
    const store = { async updateConnection(_id: string, p: unknown) { patches.push(p); } };
    await saveState(store, { id: "c" } as never, stateOf("needs_paid_plan"), new Date("2030-01-01T00:00:00Z"));
    await saveState(store, { id: "c" } as never, stateOf("needs_attention"), new Date("2030-01-01T00:00:00Z"));
    expect(patches[0]).toEqual({ health: { booking_webhook: { state: "needs_paid_plan", at: "2030-01-01T00:00:00.000Z" } } });
    expect(patches[1]).toMatchObject({ status: "needs_attention" });
  });
  it("webhook URL and signing key helpers", () => {
    expect(webhookUrlFor("https://app.test/", "cal-com", "c1")).toBe("https://app.test/api/hooks/cal-com/c1");
    expect(newSigningKey()).toMatch(/^[0-9a-f]{64}$/);
  });
});
