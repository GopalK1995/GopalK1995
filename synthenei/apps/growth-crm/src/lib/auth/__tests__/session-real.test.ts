import { describe, expect, it } from "vitest";
import { buildLiveSession, clientIp, isAppCookie, mfaStep, passwordProblem, reSign, sign, signSession, throttleBucket, verifySession } from "../session";
import { safeNext } from "../cookies";

describe("session sign/verify", () => {
  const s = buildLiveSession({ uid: "u1", email: "a@b.co", platformAdmin: false, memberships: [{ ws: "w1", role: "owner" }] });
  it("round-trips a signed session", async () => {
    expect((await verifySession(await signSession(s)))?.uid).toBe("u1");
  });
  it("rejects a tampered body", async () => {
    const [body, sig] = (await signSession(s)).split(".");
    const forged = btoa(JSON.stringify({ ...s, platformAdmin: true })).replace(/=+$/, "");
    expect(await verifySession(`${forged}.${sig}`)).toBeNull();
    expect(await verifySession(`${body}.x${sig}`)).toBeNull();
  });
  it("rejects expired tokens", async () => {
    expect(await verifySession(await sign({ ...s, iat: Date.now() - 13 * 3600e3 }))).toBeNull();
  });
  it("reSign takes memberships from the database and refreshes iat", () => {
    const r = reSign({ ...s, iat: 1 }, { platformAdmin: false, memberships: [] }, 99);
    expect(r.memberships).toEqual([]); expect(r.iat).toBe(99); expect(r.uid).toBe("u1");
  });
  it("fullName falls back to email", () => { expect(s.name).toBe("a@b.co"); expect(s.demo).toBe(false); });
});

describe("safeNext", () => {
  it("accepts same-origin paths", () => expect(safeNext("/leads?x=1")).toBe("/leads?x=1"));
  it.each(["//evil.com", "https://evil.com", String.fromCharCode(47, 92) + "evil.com", "javascript:alert(1)", "/a\u0000b", "", null])("rejects %s", (v) => expect(safeNext(v)).toBeNull());
});

describe("helpers", () => {
  it("identifies every app cookie", () => {
    for (const n of ["gcrm_session", "gcrm_ws", "gcrm_support", "gcrm_cfg_lawsome"]) expect(isAppCookie(n)).toBe(true);
    expect(isAppCookie("sb-abc-auth-token")).toBe(false);
  });
  it("throttle buckets are normalised", () => expect(throttleBucket("login", "email", " A@B.co ")).toBe("login:email:a@b.co"));
  it("client ip from x-forwarded-for", () => { expect(clientIp("1.2.3.4, 5.6.7.8")).toBe("1.2.3.4"); expect(clientIp(null)).toBe("unknown"); });
  it("mfa step: admins must enrol, others only challenge when enrolled", () => {
    expect(mfaStep({ current: "aal1", next: "aal1" }, { platformAdmin: true, hasVerifiedTotp: false })).toBe("enrol");
    expect(mfaStep({ current: "aal1", next: "aal2" }, { platformAdmin: true, hasVerifiedTotp: true })).toBe("challenge");
    expect(mfaStep({ current: "aal1", next: "aal1" }, { platformAdmin: false, hasVerifiedTotp: false })).toBe("none");
    expect(mfaStep({ current: "aal1", next: "aal2" }, { platformAdmin: false, hasVerifiedTotp: true })).toBe("challenge");
    expect(mfaStep({ current: "aal2", next: "aal2" }, { platformAdmin: true, hasVerifiedTotp: true })).toBe("none");
  });
  it("password policy", () => {
    expect(passwordProblem("short1")).toBe("short"); expect(passwordProblem("onlyletterslong")).toBe("weak");
    expect(passwordProblem("goodpass123", "other")).toBe("mismatch"); expect(passwordProblem("goodpass123", "goodpass123")).toBeNull();
  });
});
