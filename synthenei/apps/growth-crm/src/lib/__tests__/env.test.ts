import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "../env";

const S32 = "x".repeat(32);
const prod = {
  APP_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  SESSION_SECRET: S32,
  JOBS_TICK_SECRET: "tick",
};
const names = (fn: () => unknown): string[] => {
  try { fn(); } catch (e) { return (e as EnvError).names ?? ["?"]; }
  return [];
};

describe("parseEnv", () => {
  it("empty env is demo mode", () => {
    const e = parseEnv({});
    expect(e.appEnv).toBe("demo");
    expect(e.demoMode).toBe(true);
    expect(e.dataSourceSupabase).toBe(false);
  });
  it("DEMO_MODE=0 without Supabase is still demo (as before)", () => {
    expect(parseEnv({ DEMO_MODE: "0" }).demoMode).toBe(true);
  });
  it("blank values count as unset", () => {
    expect(parseEnv({ NEXT_PUBLIC_SUPABASE_URL: "", SESSION_SECRET: "" }).demoMode).toBe(true);
  });
  it("valid production", () => {
    const e = parseEnv({ ...prod, DATA_SOURCE: "supabase" });
    expect(e.demoMode).toBe(false);
    expect(e.dataSourceSupabase).toBe(true);
  });
  it("APP_ENV=demo with Supabase configured turns demo on", () => {
    expect(parseEnv({ ...prod, APP_ENV: "demo" }).demoMode).toBe(true);
  });
  it("supabase set, APP_ENV unset: staging, demo only with DEMO_MODE=1", () => {
    const { APP_ENV: _a, ...rest } = prod;
    expect(parseEnv(rest).demoMode).toBe(false);
    expect(parseEnv({ ...rest, DEMO_MODE: "1" }).demoMode).toBe(true);
  });
  it("rejects unknown APP_ENV", () => {
    expect(names(() => parseEnv({ APP_ENV: "prod" }))).toEqual(["APP_ENV"]);
  });
  it("production refuses DEMO_MODE=1", () => {
    expect(names(() => parseEnv({ ...prod, DEMO_MODE: "1" }))).toEqual(["DEMO_MODE"]);
  });
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SESSION_SECRET", "JOBS_TICK_SECRET"]) {
    it(`production fails without ${k}`, () => {
      const raw: Record<string, string> = { ...prod };
      delete raw[k];
      expect(names(() => parseEnv(raw))).toContain(k);
    });
  }
  it("production fails on short SESSION_SECRET", () => {
    expect(names(() => parseEnv({ ...prod, SESSION_SECRET: "short" }))).toEqual(["SESSION_SECRET"]);
  });
  it("staging with Supabase requires SESSION_SECRET of 32+", () => {
    expect(names(() => parseEnv({ ...prod, APP_ENV: "staging", SESSION_SECRET: undefined }))).toEqual(["SESSION_SECRET"]);
    expect(names(() => parseEnv({ ...prod, APP_ENV: "staging", SESSION_SECRET: "short" }))).toEqual(["SESSION_SECRET"]);
  });
  it("errors never contain values", () => {
    try { parseEnv({ ...prod, SESSION_SECRET: "sekret-value" }); } catch (e) { expect((e as Error).message).not.toContain("sekret-value"); }
  });
});
