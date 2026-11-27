// F29 (AUD-104): rep home keeps its empty state and greeting, groups secondary widgets for phones, and docks Log call above the bottom nav.
import { describe, expect, it, vi } from "vitest";
import { makeCtx, makeShell, makePrincipal, makeT, renderPage, state, type Mode } from "@/test/empty-harness";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/data/context", async () => ({ pageCtx: async () => (await import("@/test/empty-harness")).makeCtx(), maskName: (n: string) => n, maskEmail: (e: string) => e }));
vi.mock("@/lib/authz/load", async () => ({ loadPrincipal: async () => (await import("@/test/empty-harness")).makePrincipal(), assertCan: async () => (await import("@/test/empty-harness")).makePrincipal() }));
vi.mock("@/i18n/server", async () => ({ getT: async (ns: string) => (await import("@/test/empty-harness")).makeT(ns), pageTitle: () => async () => ({ title: "t" }), getLocale: async () => "en", getMessages: async () => ({ locale: "en", messages: {} }) }));
vi.mock("@/lib/connectors/meta/organic/read", async () => {
  const { assembleView } = await import("@/lib/connectors/meta/organic/view");
  return { loadSocialView: async () => ({ ...assembleView({ accounts: [], posts: [], postMetrics: [], accountMetrics: [], connections: [] }), state: "not_connected" }) };
});
vi.mock("@/lib/db/client", async () => ({ dbForRequest: async () => (await import("@/test/empty-harness")).emptyDb() }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`redirect:${u}`); }, notFound: () => { throw new Error("notFound"); }, useRouter: () => ({ push() {}, replace() {}, refresh() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }), headers: async () => new Headers() }));
vi.mock("@/components/shell/providers", async (orig) => {
  const m = await orig<typeof import("@/components/shell/providers")>();
  const { vocabFor } = await import("@/lib/vertical");
  return { ...m, useSession: () => makeShell(), useVocab: () => vocabFor(makeShell().tenant as never), useDealStages: () => makeShell().tenant.stageOrder.deal, useBrand: () => ({ brand: { name: "x", product: "x", hue: 245 }, setBrand() {}, reset() {} }) };
});
void [makeCtx, makePrincipal, makeT];


async function sales(mode: Mode, role: "owner" | "sales_rep" = "owner") {
  state.mode = mode; state.role = role;
  const mod = await import("../sales/page");
  return renderPage(mod.default as never);
}

describe("rep home (My Day)", { timeout: 900000 }, () => {
  it("keeps the 'No sales reps yet' empty state for an empty workspace", async () => {
    const html = await sales("empty");
    expect(html).toContain("No sales reps yet");
    expect(html).not.toContain("Log call");
  });
  it("greets by first name, collapses secondary widgets on phones and docks Log call", async () => {
    const html = await sales("demo");
    expect(html).toMatch(/Good morning, Test</);
    expect(html).toContain("Week, targets and trends");
    expect(html).toMatch(/aria-expanded="false"/);
    // the phone-only docked action: 44px (h-11), above the 56px bottom nav, hidden from lg up
    expect(html).toMatch(/fixed inset-x-0 bottom-\[calc\(3\.5rem[^"]*lg:hidden/);
    expect(html).toMatch(/h-11 w-full[^>]*>.*?Log call/s);
  });
  it("keeps every widget in the DOM (collapsed, not removed)", async () => {
    const html = await sales("demo");
    for (const t of ["Today&#x27;s touch list", "My conversion", "Weekly activity"]) expect(html).toContain(t);
  });
});
