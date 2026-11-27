// F21: every data page must render an honest empty state for a workspace with zero rows, and keep rendering with the demo dataset.
// The page is invoked as a server component with the three request-scoped modules mocked (see src/test/empty-harness.tsx).
import { describe, expect, it, vi } from "vitest";
import { BAD_TEXT, makeCtx, makeShell, makePrincipal, makeT, renderPage, state, type Mode } from "@/test/empty-harness";

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

const PAGES: { name: string; load: () => Promise<{ default: (p: never) => unknown }>; props?: Record<string, unknown>; mayNotFound?: boolean }[] = [
  { name: "home", load: () => import("../page") },
  { name: "accounts", load: () => import("../accounts/page") },
  { name: "ai", load: () => import("../ai/page") },
  { name: "analytics", load: () => import("../analytics/page") },
  { name: "audience", load: () => import("../audience/page") },
  { name: "campaigns", load: () => import("../campaigns/page") },
  { name: "contacts", load: () => import("../contacts/page") },
  { name: "data-health", load: () => import("../data-health/page") },
  { name: "inbox", load: () => import("../inbox/page") },
  { name: "leads", load: () => import("../leads/page") },
  { name: "pipeline", load: () => import("../pipeline/page") },
  { name: "sales", load: () => import("../sales/page") },
  { name: "settings", load: () => import("../settings/page") },
  { name: "tasks", load: () => import("../tasks/page") },
  { name: "account detail", load: () => import("../accounts/[id]/page"), props: { params: Promise.resolve({ id: "missing" }) }, mayNotFound: true },
  { name: "lead detail", load: () => import("../leads/[id]/page"), props: { params: Promise.resolve({ id: "missing" }) }, mayNotFound: true },
  { name: "campaign detail", load: () => import("../campaigns/[id]/page"), props: { params: Promise.resolve({ id: "missing" }) }, mayNotFound: true },
];

for (const mode of ["empty", "demo"] as Mode[]) {
  describe(`${mode} workspace`, () => {
    for (const p of PAGES) {
      it(`${p.name} renders without throwing and without NaN text`, async () => {
        state.mode = mode;
        const mod = await p.load();
        let html: string;
        try { html = await renderPage(mod.default as never, p.props); } catch (e) {
          if (p.mayNotFound && String((e as Error).message) === "notFound") return; // an unknown record id is a 404, not a crash
          throw e;
        }
        expect(html.length).toBeGreaterThan(200);
        expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(BAD_TEXT);
        expect(html).not.toMatch(/could not load its data/i);
      }, 900000);
    }
  });
}
