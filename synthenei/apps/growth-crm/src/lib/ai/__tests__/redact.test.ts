import { describe, expect, it } from "vitest";
import { redactAll, redactPrompt } from "../redact";
import { evaluateCaps, estimateTokens } from "../caps";
import type { CapStatus } from "../types";

const r = (s: string, extended = true) => redactPrompt(s, { extended });

describe("PII redaction", () => {
  it("removes emails, Indian and international phone numbers", () => {
    expect(r("mail a.b+c@firm.co.in now").text).toBe("mail [email] now");
    expect(r("call 98765 43210 or +91-98765-43210 or +1 (415) 555-0132").text).toBe("call [phone] or [phone] or [phone]");
  });
  it("removes Aadhaar-like, PAN and Luhn-valid card numbers", () => {
    expect(r("aadhaar 2345 6789 0123").text).toBe("aadhaar [id-number]");
    expect(r("PAN ABCDE1234F ok").text).toBe("PAN [id-number] ok");
    expect(r("card 4111 1111 1111 1111").text).toBe("card [card]");
  });
  it("leaves dates, amounts, times and short numbers alone", () => {
    const s = "On 2026-11-21 10:30 she paid 1,25,000 for 12 seats, ref 4521.";
    expect(r(s).text).toBe(s);
    expect(r(s).count).toBe(0);
  });
  it("removes IP addresses but keeps version-like numbers", () => {
    expect(r("from 203.0.113.7 today").text).toBe("from [ip] today");
    expect(r("version 1.2.3.999").text).toBe("version 1.2.3.999");
  });
  it("strips query strings (magic links, tracking) and secrets", () => {
    expect(r("open https://app.example.com/x?token=abc&u=1 now").text).toBe("open https://app.example.com/x now");
    const s = r("api_key=sk-abcdefghijklmnop123456 and Bearer abcdefghijklmnop123").text;
    expect(s).not.toMatch(/abcdefghijklmnop/);
  });
  it("extended level (policy) also masks PIN codes and dates of birth; core stays on without it", () => {
    expect(r("Chennai 600001, DOB: 12 May 1990").text).toBe("Chennai [pin], [dob]");
    expect(r("Chennai 600001 asha@x.in", false).text).toBe("Chennai 600001 [email]");
  });
  it("counts replacements across parts", () => {
    const o = redactAll(["a@b.co", "no pii", "call 98765 43210"], { extended: true });
    expect(o.parts).toEqual(["[email]", "no pii", "call [phone]"]);
    expect(o.count).toBe(2);
  });
});

const caps = (p: Partial<CapStatus["caps"]> = {}, u: Partial<CapStatus["usage"]> = {}, top: Partial<CapStatus> = {}): CapStatus => ({
  allowed: true, reason: null, usage: { calls_month: 0, tokens_month: 0, user_calls_today: 0, ...u }, caps: { monthly_call_cap: null, monthly_token_cap: null, per_user_daily_cap: null, plan_calls: null, ...p }, ...top,
});

describe("cap evaluation (fails closed)", () => {
  it("allows when nothing is exceeded or capped", () => { expect(evaluateCaps(caps()).ok).toBe(true); });
  it("blocks at each cap, including the plan limit", () => {
    expect(evaluateCaps(caps({ monthly_call_cap: 5 }, { calls_month: 5 }))).toEqual({ ok: false, reason: "monthly_calls" });
    expect(evaluateCaps(caps({ plan_calls: 5 }, { calls_month: 9 }))).toEqual({ ok: false, reason: "plan_calls" });
    expect(evaluateCaps(caps({ per_user_daily_cap: 2 }, { user_calls_today: 2 }))).toEqual({ ok: false, reason: "user_daily" });
    expect(evaluateCaps(caps({ monthly_token_cap: 1000 }, { tokens_month: 900 }), 200)).toEqual({ ok: false, reason: "monthly_tokens" });
  });
  it("a cap of zero blocks every call", () => { expect(evaluateCaps(caps({ monthly_call_cap: 0 })).ok).toBe(false); });
  it("honours the database verdict and a missing or malformed answer", () => {
    expect(evaluateCaps(caps({}, {}, { allowed: false, reason: "user_daily" }))).toEqual({ ok: false, reason: "user_daily" });
    expect(evaluateCaps(null)).toEqual({ ok: false, reason: "unavailable" });
    expect(evaluateCaps({} as CapStatus)).toEqual({ ok: false, reason: "unavailable" });
  });
  it("estimates tokens from characters plus the output budget", () => { expect(estimateTokens(350, 100)).toBe(200); });
});
