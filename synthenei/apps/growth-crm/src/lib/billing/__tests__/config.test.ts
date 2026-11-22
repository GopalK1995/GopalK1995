import { describe, expect, it } from "vitest";
import { graceDays, issuerConfig, razorpayConfig } from "../config";

const ISSUER_ENV = { BILLING_GSTIN: "33AAAAA0000A1Z5", BILLING_SAC_CODE: "998314", BILLING_GST_RATE_PERCENT: "18", BILLING_LEGAL_NAME: "Synthenei Technologies" };

describe("issuerConfig", () => {
  it("ok with all four vars present and valid", () => {
    const r = issuerConfig(ISSUER_ENV);
    expect(r).toMatchObject({ ok: true, cfg: { gstin: "33AAAAA0000A1Z5", sac: "998314", gstRatePercent: 18, legalName: "Synthenei Technologies" } });
  });
  it("names every missing or malformed var", () => {
    const r = issuerConfig({ BILLING_GSTIN: "bad", BILLING_GST_RATE_PERCENT: "101" });
    expect(r.ok).toBe(false);
    expect((r as { missing: string[] }).missing).toEqual(["BILLING_GSTIN", "BILLING_SAC_CODE", "BILLING_GST_RATE_PERCENT", "BILLING_LEGAL_NAME"]);
  });
  it("splits a pipe-separated address into lines, empty when unset", () => {
    const r = issuerConfig({ ...ISSUER_ENV, BILLING_ADDRESS: "12 Anna Salai | Chennai | 600002" });
    expect(r).toMatchObject({ ok: true, cfg: { address: ["12 Anna Salai", "Chennai", "600002"] } });
    expect(issuerConfig(ISSUER_ENV)).toMatchObject({ cfg: { address: [] } });
  });
});

describe("graceDays", () => {
  it("unset means never enforced", () => expect(graceDays({})).toBeNull());
  it("accepts an integer 0-365, rejects anything else", () => {
    expect(graceDays({ BILLING_PAST_DUE_GRACE_DAYS: "7" })).toBe(7);
    expect(graceDays({ BILLING_PAST_DUE_GRACE_DAYS: "0" })).toBe(0);
    expect(graceDays({ BILLING_PAST_DUE_GRACE_DAYS: "366" })).toBeNull();
    expect(graceDays({ BILLING_PAST_DUE_GRACE_DAYS: "-1" })).toBeNull();
    expect(graceDays({ BILLING_PAST_DUE_GRACE_DAYS: "abc" })).toBeNull();
  });
});

describe("razorpayConfig", () => {
  const base = { RAZORPAY_KEY_ID: "rzp_test_abc123", RAZORPAY_KEY_SECRET: "sekrit" };
  it("not_configured when either key is missing", () => {
    expect(razorpayConfig({})).toMatchObject({ ok: false, reason: "not_configured" });
    expect(razorpayConfig({ RAZORPAY_KEY_ID: "rzp_test_abc123" })).toMatchObject({ ok: false, reason: "not_configured" });
  });
  it("bad_key when the key id doesn't match the rzp_(test|live)_ shape", () => {
    expect(razorpayConfig({ ...base, RAZORPAY_KEY_ID: "not-a-key" })).toMatchObject({ ok: false, reason: "bad_key" });
  });
  it("test mode by default, live refused without the flag, mismatch when a test key sets the live flag", () => {
    expect(razorpayConfig(base)).toMatchObject({ ok: true, cfg: { mode: "test" } });
    expect(razorpayConfig({ ...base, RAZORPAY_KEY_ID: "rzp_live_abc123" })).toMatchObject({ ok: false, reason: "live_refused" });
    expect(razorpayConfig({ ...base, RAZORPAY_KEY_ID: "rzp_live_abc123", BILLING_RAZORPAY_LIVE: "1" })).toMatchObject({ ok: true, cfg: { mode: "live" } });
    expect(razorpayConfig({ ...base, BILLING_RAZORPAY_LIVE: "1" })).toMatchObject({ ok: false, reason: "mode_mismatch" });
  });
  it("defaults the API base and strips a trailing slash from a custom one", () => {
    expect(razorpayConfig(base)).toMatchObject({ cfg: { apiBase: "https://api.razorpay.com" } });
    expect(razorpayConfig({ ...base, RAZORPAY_API_BASE: "https://sandbox.example/" })).toMatchObject({ cfg: { apiBase: "https://sandbox.example" } });
  });
});
