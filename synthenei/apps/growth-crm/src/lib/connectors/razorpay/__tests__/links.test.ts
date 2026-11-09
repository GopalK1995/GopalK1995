import { beforeEach, describe, expect, it } from "vitest";
import { CredentialError, TransientError } from "../../core/types";
import { gatewayFor, isShowcaseConnection, resetMockGateways } from "../config";
import { RazorpayApiError } from "../gateway";
import { createPaymentRequest } from "../links";
import { RZP_MOCK_KEY_ID, RZP_MOCK_KEY_SECRET, makeMockGateway } from "../mock";
import { CONN, FakeStore, TENANT, WS, mkConn, mkDeps } from "./fake-store";

let st: FakeStore;
const conn = mkConn();
beforeEach(() => { st = new FakeStore(); st.deals.push({ id: "deal-1", workspaceId: WS, name: "Annual booking", valueInr: 1999.99, leadId: "lead-1", stageId: "s", pipelineId: null }); resetMockGateways(); });

describe("createPaymentRequest", () => {
  it("creates a link for a deal using its value in exact paise, writes the row first and uses its id as the vendor reference", async () => {
    const gw = makeMockGateway();
    const r = await createPaymentRequest(mkDeps(st), conn, gw, { dealId: "deal-1" });
    expect(r).toMatchObject({ ok: true, reused: false, showcase: true, url: expect.stringContaining("mock://pay/") });
    if (!r.ok) return;
    expect(r.payment).toMatchObject({ amountPaise: 199999, currency: "INR", dealId: "deal-1", leadId: "lead-1", tenantId: TENANT, workspaceId: WS, integrationId: CONN });
    expect(st.payments[0]).toMatchObject({ status: "created", externalId: gw.links[0].id, linkUrl: r.url });
    expect(gw.links[0]).toMatchObject({ referenceId: r.payment.id, amount: 199999, currency: "INR", notes: { crm_payment_id: r.payment.id } });
    expect(st.events.map((e) => e.type)).toEqual(["payment.created"]);
  });
  it("an explicit integer paise amount wins over the deal value; floats, zero and oversized amounts are refused before any row exists", async () => {
    const gw = makeMockGateway();
    expect(await createPaymentRequest(mkDeps(st), conn, gw, { dealId: "deal-1", amountPaise: 500 })).toMatchObject({ ok: true, payment: { amountPaise: 500 } });
    for (const [amountPaise, code] of [[12.5, "invalid_amount"], [0, "invalid_amount"], [-1, "invalid_amount"], [Number.MAX_SAFE_INTEGER, "too_large"]] as const) {
      expect(await createPaymentRequest(mkDeps(st), conn, makeMockGateway(), { leadId: "l", amountPaise })).toEqual({ ok: false, code });
    }
    expect(st.payments).toHaveLength(1);
  });
  it("needs a target and a valid currency; a lead-only request needs an explicit amount", async () => {
    const gw = makeMockGateway();
    expect(await createPaymentRequest(mkDeps(st), conn, gw, { amountPaise: 100 })).toEqual({ ok: false, code: "no_target" });
    expect(await createPaymentRequest(mkDeps(st), conn, gw, { leadId: "l", amountPaise: 100, currency: "rupees" })).toEqual({ ok: false, code: "invalid_currency" });
    expect(await createPaymentRequest(mkDeps(st), conn, gw, { leadId: "l" })).toEqual({ ok: false, code: "invalid_amount" });
  });
  it("a deal of another workspace is not found", async () => {
    const r = await createPaymentRequest(mkDeps(st), mkConn({ workspaceId: "ws-other" }), makeMockGateway(), { dealId: "deal-1" });
    expect(r).toEqual({ ok: false, code: "deal_not_found" });
    expect(st.payments).toEqual([]);
  });
  it("asking again for the same deal returns the same open link; a different amount is refused", async () => {
    const gw = makeMockGateway();
    const a = await createPaymentRequest(mkDeps(st), conn, gw, { dealId: "deal-1" });
    const b = await createPaymentRequest(mkDeps(st), conn, gw, { dealId: "deal-1" });
    expect(b).toMatchObject({ ok: true, reused: true });
    expect(b.ok && a.ok && b.payment.id).toBe(a.ok && a.payment.id);
    expect(gw.links).toHaveLength(1);
    expect(await createPaymentRequest(mkDeps(st), conn, gw, { dealId: "deal-1", amountPaise: 1 })).toMatchObject({ ok: false, code: "amount_mismatch" });
  });
  it("creates an order instead of a link on request", async () => {
    const gw = makeMockGateway();
    const r = await createPaymentRequest(mkDeps(st), conn, gw, { leadId: "l", amountPaise: 700, kind: "order" });
    expect(r).toMatchObject({ ok: true, url: null });
    expect(gw.orders[0]).toMatchObject({ amount: 700, receipt: st.payments[0].id });
    expect(st.payments[0].externalId).toBe(gw.orders[0].id);
  });
  it("a vendor refusal or outage cancels the row, keeps no secrets in the result and says whether a retry makes sense", async () => {
    const gw = makeMockGateway();
    gw.failNext(400);
    expect(await createPaymentRequest(mkDeps(st), conn, gw, { dealId: "deal-1" })).toMatchObject({ ok: false, code: "gateway_rejected" });
    expect(st.payments[0]).toMatchObject({ status: "cancelled", failureCode: "create_failed" });
    gw.failNext(503);
    expect(await createPaymentRequest(mkDeps(st), conn, gw, { dealId: "deal-1" })).toMatchObject({ ok: false, code: "transient" });
    const dead = { ...makeMockGateway(), createPaymentLink: async () => { throw new CredentialError("x"); } };
    expect(await createPaymentRequest(mkDeps(st), conn, dead, { dealId: "deal-1" })).toMatchObject({ ok: false, code: "credentials" });
    const net = { ...makeMockGateway(), createPaymentLink: async () => { throw new TransientError("net"); } };
    expect(await createPaymentRequest(mkDeps(st), conn, net, { dealId: "deal-1" })).toMatchObject({ ok: false, code: "transient" });
    expect(new RazorpayApiError("X", "m", 500, "server", true).transient).toBe(true);
  });
});

describe("showcase gateway selection", () => {
  const secrets = { key_id: RZP_MOCK_KEY_ID, key_secret: RZP_MOCK_KEY_SECRET, webhook_secret: "w" };
  it("the mock key serves the showcase gateway outside production and is refused in production", () => {
    expect(gatewayFor({ connectionId: "c", secrets, env: { APP_ENV: "staging" } }).kind).toBe("mock");
    expect(() => gatewayFor({ connectionId: "c", secrets, env: { APP_ENV: "production" } })).toThrow(CredentialError);
    expect(isShowcaseConnection(secrets, {})).toBe(true);
    expect(isShowcaseConnection({ key_id: "rzp_test_abcdef", key_secret: "real" }, { APP_ENV: "staging" })).toBe(false);
  });
  it("demo mode without keys is a showcase; real keys use the API gateway and never the network in the mock", async () => {
    expect(gatewayFor({ connectionId: "c", secrets: {}, env: { APP_ENV: "demo" } }).kind).toBe("mock");
    expect(isShowcaseConnection({}, { APP_ENV: "demo" })).toBe(true);
    expect(() => gatewayFor({ connectionId: "c", secrets: {}, env: {} })).toThrow(CredentialError);
    let called = 0;
    const g = gatewayFor({ connectionId: "c", secrets: { key_id: "rzp_test_abcdef", key_secret: "s" }, env: { RAZORPAY_API_BASE: "https://stub.invalid" }, fetchImpl: (async () => { called++; return new Response("{}", { status: 200 }); }) as typeof fetch });
    expect(g.kind).toBe("api");
    await g.probe();
    expect(called).toBe(1);
    const m = gatewayFor({ connectionId: "c", secrets, env: {}, fetchImpl: (async () => { throw new Error("network used"); }) as typeof fetch });
    await expect(m.probe()).resolves.toMatchObject({ ok: true, mode: "test" });
  });
});
