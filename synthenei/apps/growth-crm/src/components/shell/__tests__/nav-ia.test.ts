import { describe, expect, it } from "vitest";
import { NAV, NAV_ITEM_KEYS, navFor, settingsLinksFor } from "../nav";
import { scopeName } from "@/lib/workspace-label";

const hrefs = (r: Parameters<typeof navFor>[0]) => navFor(r).flatMap((g) => g.items.map((i) => i.href));
describe("AUD-046 sidebar", () => {
  it("owner sees at most 20 top-level links", () => expect(hrefs("owner").length).toBeLessThanOrEqual(20));
  it("canonical names", () => {
    const labels = NAV.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain("Home"); expect(labels).toContain("Access"); expect(labels).toContain("Audience");
    expect(labels).not.toContain("Command Center"); expect(labels).not.toContain("Roles & access");
  });
  it("exposes /contacts and drops duplicate notification entries", () => {
    expect(hrefs("owner")).toContain("/contacts");
    expect(hrefs("owner")).not.toContain("/notifications");
    expect(hrefs("owner")).not.toContain("/settings/notifications");
  });
  it("every moved configuration page is still reachable from the settings list", () => {
    const all = [...hrefs("owner"), ...settingsLinksFor("owner").map((l) => l.href)];
    for (const h of ["/settings/notifications", "/settings/billing", "/settings/api-keys", "/settings/webhooks", "/settings/pipelines", "/settings/email", "/settings/privacy", "/settings/fields", "/settings/objects", "/settings/layouts", "/import", "/data-health"]) expect(all).toContain(h);
    expect(settingsLinksFor("sales_rep").map((l) => l.href)).toContain("/settings/notifications");
  });
  it("every sidebar and settings link has a message key", () => {
    for (const h of [...NAV.flatMap((g) => g.items), ...settingsLinksFor("owner")].map((i) => i.href)) expect(NAV_ITEM_KEYS[h], h).toBeTruthy();
  });
  it("workspace name is not doubled", () => {
    expect(scopeName("LAWSOME", "LAWSOME")).toBe("LAWSOME");
    expect(scopeName("LAWSOME", "Tamil Nadu")).toBe("LAWSOME · Tamil Nadu");
  });
});
