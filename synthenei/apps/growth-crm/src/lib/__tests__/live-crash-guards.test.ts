import { describe, expect, it } from "vitest";
import { humanMessage } from "../error-message";
import { classifyError } from "../billing/cause";
import { accessFor, isKnownPath } from "../auth/roles";
import { pagePermission } from "../authz/pages";

describe("error boundary text", () => {
  it("never shows the raw production framework message", () => {
    const raw = "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.";
    const t = humanMessage({ message: raw, digest: "4252757374" });
    expect(t).not.toMatch(/Server Components|omitted/);
    expect(t).toMatch(/Retry/);
  });
  it("explains a database read failure", () => expect(humanMessage({ message: "Could not read accounts: permission denied" })).toMatch(/database/));
});

describe("billing failure cause", () => {
  it("separates configuration, database and unknown", () => {
    expect(classifyError(new Error("serviceDb: Supabase URL or service credentials are not configured"))).toBe("unconfigured");
    expect(classifyError(new Error("permission denied for table tenants"))).toBe("database");
    expect(classifyError(new Error("boom"))).toBe("unknown");
  });
});

describe("page access", () => {
  it("lets every role open /onboarding, matching authz/pages.ts", () => {
    expect(pagePermission("/onboarding")).toBeNull();
    for (const r of ["owner", "sales_manager", "sales_rep", "marketing", "data", "viewer"] as const) expect(accessFor(r, "/onboarding"), r).not.toBeNull();
  });
  it("the owner can open billing settings", () => expect(accessFor("owner", "/settings/billing")).toBe("F"));
  it("unknown URLs are not known routes (404, not a role 403)", () => {
    expect(isKnownPath("/billing")).toBe(false);
    expect(isKnownPath("/definitely-not-a-page")).toBe(false);
    for (const p of ["/", "/accounts", "/accounts/abc", "/leads/1", "/settings/billing", "/onboarding", "/o/thing", "/import", "/contacts"]) expect(isKnownPath(p), p).toBe(true);
  });
});
