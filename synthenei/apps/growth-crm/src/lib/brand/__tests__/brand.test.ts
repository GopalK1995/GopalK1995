import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { fillPlatform, platformName, platformProduct } from "../platform";
const { brandFromRow, hostOnly, hueFromHex } = await import("../public-brand");

describe("platform name (AUD-026)", () => {
  it("comes from config, never from code", () => {
    expect(platformName("en", { PLATFORM_PRODUCT_NAME: "Acme CRM" })).toBe("Acme CRM");
    expect(platformName("en", { NEXT_PUBLIC_PLATFORM_NAME: "Acme" })).toBe("Acme");
    expect(platformProduct({})).toBeNull();
  });
  it("unset: a neutral word that names no company or customer", () => {
    for (const l of ["en", "ta"] as const) expect(platformName(l, {})).not.toMatch(/synthan|growth crm|lawsome/i);
    expect(fillPlatform("Not set up by {platform}", "en", {})).toBe("Not set up by the platform");
    expect(fillPlatform("Set up by {platform}", "en", { PLATFORM_PRODUCT_NAME: "Acme" })).toBe("Set up by Acme");
  });
});

describe("public brand from a tenants row", () => {
  it("maps brand_name, https logo and the primary colour hue", () => {
    const b = brandFromRow({ slug: "kaveri-demo", brand_name: "Kaveri Stays", brand_logo_url: "https://cdn.example/l.png", brand_primary: "#0F8B8D" });
    expect(b).toMatchObject({ source: "db", slug: "kaveri-demo", name: "Kaveri Stays", monogram: "K", logoUrl: "https://cdn.example/l.png" });
    expect(b!.hue).toBeGreaterThan(170); expect(b!.hue).toBeLessThan(190);
  });
  it("rejects non-https logos, bad colours and a missing name", () => {
    expect(brandFromRow({ brand_name: "X", brand_logo_url: "javascript:alert(1)", brand_primary: "red" })).toMatchObject({ logoUrl: null, hue: 245 });
    expect(brandFromRow({ brand_name: "  " })).toBeNull();
  });
  it("host header to bare hostname", () => {
    expect(hostOnly("Crm.Client.COM:3000")).toBe("crm.client.com");
    expect(hostOnly("bad host")).toBeNull();
    expect(hueFromHex("#ff0000")).toBe(0);
  });
});
