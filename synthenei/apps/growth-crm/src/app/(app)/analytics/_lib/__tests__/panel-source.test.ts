import { describe, expect, it } from "vitest";
import { modeBanner, panelSources, SOURCE_LABEL } from "../panel-source";

describe("analytics panel sources", () => {
  it("demo workspace: everything is sample, banner says demo", () => {
    const s = panelSources({ demo: true, ga4Connected: false });
    expect(s).toEqual({ ga4: "sample", crm: "sample" });
    expect(modeBanner(s, "Acme")).toContain("sample series");
  });
  it("real workspace without GA4: GA4 panels are empty, CRM panels are real, no sample claim", () => {
    const s = panelSources({ demo: false, ga4Connected: false });
    expect(s).toEqual({ ga4: "none", crm: "crm" });
    expect(modeBanner(s, "Acme")).not.toMatch(/sample series/);
    expect(modeBanner(s, "Acme")).toContain("not connected");
    expect(SOURCE_LABEL[s.ga4]).toContain("not connected");
  });
  it("real workspace with GA4: GA4 and CRM, no banner", () => {
    const s = panelSources({ demo: false, ga4Connected: true });
    expect(s).toEqual({ ga4: "ga4", crm: "crm" });
    expect(modeBanner(s, "Acme")).toBeNull();
  });
  it("a demo session never reports a live source", () => {
    expect(Object.values(panelSources({ demo: true, ga4Connected: true }))).not.toContain("ga4");
  });
});
