import { describe, expect, it } from "vitest";
import { CredentialError, TransientError } from "../../core/types";
import { makeApiGateway } from "../api";
import { RazorpayApiError } from "../gateway";

interface Call { url: string; method: string; headers: Record<string, string>; body: unknown }
function stub(responses: (Response | Error)[]) {
  const calls: Call[] = [], sleeps: number[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const r = responses.shift() ?? new Response("{}", { status: 200 });
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { calls, sleeps, gw: (policy = {}) => makeApiGateway({ apiBase: "https://stub.invalid/", keyId: "rzp_test_abcdef", keySecret: "SECRET-VALUE", fetch: fetchImpl, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5, policy }) };
}
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers });
const link = { amount: 250000, currency: "INR", referenceId: "ref-1", description: "d", notes: { crm_payment_id: "ref-1" } };

describe("Razorpay API gateway", () => {
  it("authenticates with HTTP Basic and posts a payment link with paise, notify off and no reminders", async () => {
    const s = stub([json({ id: "plink_1", short_url: "https://rzp.io/i/x", status: "created" })]);
    const r = await s.gw().createPaymentLink({ ...link, customer: { name: "A" }, expireBy: 1_800_000_000, callbackUrl: "https://app.invalid/back" });
    expect(r).toEqual({ id: "plink_1", shortUrl: "https://rzp.io/i/x", status: "created" });
    const c = s.calls[0];
    expect(c.url).toBe("https://stub.invalid/v1/payment_links");
    expect(c.headers.authorization).toBe(`Basic ${Buffer.from("rzp_test_abcdef:SECRET-VALUE").toString("base64")}`);
    expect(c.body).toMatchObject({ amount: 250000, currency: "INR", reference_id: "ref-1", notify: { sms: false, email: false }, reminder_enable: false, expire_by: 1_800_000_000, callback_method: "get" });
  });
  it("creates orders with the receipt and reads refunds read-only", async () => {
    const s = stub([json({ id: "order_1", status: "created" }), json({ items: [{ id: "rfnd_1", amount: 500, currency: "INR", status: "processed", created_at: 1_700_000_000 }, { bogus: true }] })]);
    expect(await s.gw().createOrder({ amount: 700, currency: "INR", receipt: "r-1", notes: {} })).toEqual({ id: "order_1", status: "created" });
    expect(s.calls[0].body).toMatchObject({ amount: 700, receipt: "r-1" });
    const refunds = await s.gw().listRefunds("pay_1");
    expect(refunds).toEqual([{ id: "rfnd_1", paymentId: "pay_1", amount: 500, currency: "INR", status: "processed", createdAt: new Date(1_700_000_000_000).toISOString() }]);
    expect(s.calls[1].method).toBe("GET");
  });
  it("retries 429, 5xx and network errors with backoff, honouring Retry-After, then succeeds", async () => {
    const s = stub([json({}, 429, { "retry-after": "2" }), json({}, 503), new Error("ECONNRESET"), json({ id: "plink_2", short_url: "u" })]);
    const r = await s.gw().createPaymentLink(link);
    expect(r.id).toBe("plink_2");
    expect(s.calls).toHaveLength(4);
    expect(s.sleeps[0]).toBe(2000);
    expect(s.sleeps).toHaveLength(3);
    expect(s.sleeps[2]).toBeGreaterThan(0);
  });
  it("gives up after the retry budget with a transient error", async () => {
    const s = stub(Array.from({ length: 10 }, () => json({}, 500)));
    await expect(s.gw({ maxRetries: 2 }).createPaymentLink(link)).rejects.toBeInstanceOf(TransientError);
    expect(s.calls).toHaveLength(3);
    const n = stub(Array.from({ length: 10 }, () => new Error("down")));
    await expect(n.gw({ maxRetries: 1 }).probe()).rejects.toBeInstanceOf(TransientError);
  });
  it("401 is a dead-credentials error and is not retried; a 400 keeps the vendor code but not its description", async () => {
    const s = stub([json({ error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" } }, 401)]);
    await expect(s.gw().probe()).rejects.toBeInstanceOf(CredentialError);
    expect(s.calls).toHaveLength(1);
    const b = stub([json({ error: { code: "BAD_REQUEST_ERROR", description: "contact +910000000000 is invalid", field: "customer.contact" } }, 400)]);
    const err = await b.gw().createPaymentLink(link).catch((e) => e);
    expect(err).toBeInstanceOf(RazorpayApiError);
    expect(err).toMatchObject({ code: "BAD_REQUEST_ERROR", failure: "bad_request", transient: false });
    expect(err.message).not.toContain("910000000000");
  });
  it("never puts the key secret or customer details in an error message", async () => {
    const s = stub([json({ error: { code: "SERVER_ERROR", description: "SECRET-VALUE leaked" } }, 502), json({}, 502), json({}, 502)]);
    const err = await s.gw({ maxRetries: 2 }).createPaymentLink({ ...link, customer: { email: "customer@example.test" } }).catch((e) => e);
    expect(String(err.message)).not.toMatch(/SECRET-VALUE|customer@example/);
  });
  it("probe reports the key mode and fails on a response without an id", async () => {
    expect(await stub([json({ items: [] })]).gw().probe()).toEqual({ ok: true, mode: "test" });
    await expect(stub([json({ short_url: "u" })]).gw().createPaymentLink(link)).rejects.toBeInstanceOf(TransientError);
  });
});
