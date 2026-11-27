import { describe, expect, it } from "vitest";
import { passwordProblem, isCommonPassword } from "../password-policy";
import { isPrivilegedRole, mfaRequirement, parseMfaPolicy, roleRequiresMfa, DEFAULT_MFA_POLICY } from "../mfa-policy";
import { mfaStep } from "../session";
import { mfaGate, type GateClient } from "../mfa-gate";
import { validateOverrides } from "../../config/types";

describe("password policy (NIST 800-63B)", () => {
  it("requires 12 characters and no composition", () => {
    expect(passwordProblem("short pass")).toBe("short");
    expect(passwordProblem("elevenchars")).toBe("short");
    expect(passwordProblem("twelve chars")).toBeNull(); // letters and a space only: composition is not required
    expect(passwordProblem("purple tractor window lantern")).toBeNull();
  });
  it("accepts a 64-character passphrase and any unicode, rejects past the 72-byte bcrypt limit", () => {
    const p64 = "correct-battery-staple-orbit-lemon-harbor-violet-meadow-fabric-7";
    expect(p64.length).toBe(64);
    expect(passwordProblem(p64)).toBeNull();
    expect(passwordProblem("வணக்கம் உலகம் நல்ல மாலை")).toBeNull();
    expect(passwordProblem("x9".repeat(40))).toBe("long");
  });
  it("rejects common and breached passwords and their trivial variants", () => {
    for (const p of ["password1234", "Password12345!", "P@ssw0rd1234", "qwertyuiop123", "iloveyou12345", "123456789012", "aaaaaaaaaaaa", "abcabcabcabc", "qwertyuiopasdf", "Welcome@123456", "letmein123456", "synthan@1234"])
      expect(passwordProblem(p), p).toBe("common");
    expect(isCommonPassword("Tr0ub4dor&3 horse battery")).toBe(false);
  });
  it("rejects the user's own email name; mismatch last", () => {
    expect(passwordProblem("my-gopal-krishna-secret-key", undefined, { email: "gopalkrishna@example.com" })).toBe("context");
    expect(passwordProblem("a long unique passphrase", "different")).toBe("mismatch");
    expect(passwordProblem("a long unique passphrase", "a long unique passphrase")).toBeNull();
  });
});

describe("MFA policy", () => {
  it("default: owner, sales_manager and manage/export roles are privileged; reps and viewers are optional", () => {
    expect(isPrivilegedRole("owner")).toBe(true);
    expect(isPrivilegedRole("sales_manager")).toBe(true);
    expect(isPrivilegedRole("data")).toBe(true);
    expect(isPrivilegedRole("sales_rep")).toBe(false);
    expect(isPrivilegedRole("viewer")).toBe(false);
  });
  it("tenant mode all requires everyone; garbage config falls back to the default, never off", () => {
    expect(roleRequiresMfa("viewer", { mode: "all", graceUntil: null })).toBe(true);
    expect(parseMfaPolicy(undefined)).toEqual(DEFAULT_MFA_POLICY);
    expect(parseMfaPolicy({ security: { mfa: "off" } })).toEqual(DEFAULT_MFA_POLICY);
    expect(parseMfaPolicy({ security: "x" })).toEqual(DEFAULT_MFA_POLICY);
  });
  it("grace is capped at 30 days and only counts when every requiring tenant has one", () => {
    const now = Date.parse("2026-12-01T00:00:00Z");
    expect(parseMfaPolicy({ security: { mfaGraceUntil: "2026-12-10" } }, now).graceUntil).not.toBeNull();
    expect(parseMfaPolicy({ security: { mfaGraceUntil: "2027-06-01" } }, now).graceUntil).toBeNull();
    expect(parseMfaPolicy({ security: { mfaGraceUntil: "2026-11-01" } }, now).graceUntil).toBeNull();
    const g = parseMfaPolicy({ security: { mfaGraceUntil: "2026-12-10" } }, now);
    expect(mfaRequirement([{ role: "owner", policy: g }], now)).toEqual({ required: true, graceActive: true });
    expect(mfaRequirement([{ role: "owner", policy: g }, { role: "owner", policy: DEFAULT_MFA_POLICY }], now).graceActive).toBe(false);
    expect(mfaRequirement([{ role: "sales_rep", policy: DEFAULT_MFA_POLICY }], now).required).toBe(false);
  });
  it("mfaStep: required with no factor enrols, a factor challenges, grace defers enrolment only", () => {
    const a = { current: "aal1", next: "aal1" };
    expect(mfaStep(a, { platformAdmin: false, hasVerifiedTotp: false, required: true })).toBe("enrol");
    expect(mfaStep(a, { platformAdmin: false, hasVerifiedTotp: false, required: true, graceActive: true })).toBe("none");
    expect(mfaStep({ current: "aal1", next: "aal2" }, { platformAdmin: false, hasVerifiedTotp: true, required: true, graceActive: true })).toBe("challenge");
    expect(mfaStep({ current: "aal2", next: "aal2" }, { platformAdmin: false, hasVerifiedTotp: true, required: true })).toBe("none");
  });
  it("config validator accepts the security block and rejects a bad mode", () => {
    expect(validateOverrides({ security: { mfa: "all", mfaGraceUntil: "2026-12-10" } }).issues).toEqual([]);
    expect(validateOverrides({ security: { mfa: "off" } }).issues.length).toBe(1);
  });
});

function fakeSb(o: { role: string; factors?: { status: string }[]; level?: string; cfg?: unknown; cfgThrows?: boolean; wsError?: boolean }): GateClient {
  const verified = !!o.factors?.some((f) => f.status === "verified");
  return {
    rpc: async () => ({ data: o.wsError ? null : [{ tenant_id: "t1", role: o.role }] }),
    from: () => ({ select: () => ({ in: async () => { if (o.cfgThrows) throw new Error("boom"); return { data: o.cfg ? [{ tenant_id: "t1", config: o.cfg }] : [] }; } }) }),
    auth: { mfa: {
      getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: o.level ?? "aal1", nextLevel: verified ? "aal2" : "aal1" } }),
      listFactors: async () => ({ data: { totp: o.factors ?? [] } }),
    } },
  } as GateClient;
}

describe("mfaGate: rollout safety for the owner", () => {
  it("owner with NO factor is routed to enrolment (never none, never a challenge dead end)", async () => {
    expect(await mfaGate(fakeSb({ role: "owner" }), false)).toBe("enrol");
  });
  it("owner with a factor is challenged until AAL2, then passes", async () => {
    const f = [{ status: "verified" }];
    expect(await mfaGate(fakeSb({ role: "owner", factors: f }), false)).toBe("challenge");
    expect(await mfaGate(fakeSb({ role: "owner", factors: f, level: "aal2" }), false)).toBe("none");
  });
  it("an unverified (abandoned) factor does not count: owner still goes to enrolment", async () => {
    expect(await mfaGate(fakeSb({ role: "owner", factors: [{ status: "unverified" }] }), false)).toBe("enrol");
  });
  it("a policy lookup failure keeps the default (owner still enrols), a rep stays optional", async () => {
    expect(await mfaGate(fakeSb({ role: "owner", cfgThrows: true }), false)).toBe("enrol");
    expect(await mfaGate(fakeSb({ role: "sales_rep" }), false)).toBe("none");
  });
  it("tenant grace lets an owner without a factor in, but not past an existing factor", async () => {
    const d = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
    expect(await mfaGate(fakeSb({ role: "owner", cfg: { security: { mfaGraceUntil: d } } }), false)).toBe("none");
    expect(await mfaGate(fakeSb({ role: "owner", factors: [{ status: "verified" }], cfg: { security: { mfaGraceUntil: d } } }), false)).toBe("challenge");
  });
  it("tenant mode all enrols a rep; platform admin always enrols", async () => {
    expect(await mfaGate(fakeSb({ role: "sales_rep", cfg: { security: { mfa: "all" } } }), false)).toBe("enrol");
    expect(await mfaGate(fakeSb({ role: "viewer", wsError: true }), true)).toBe("enrol");
  });
});
