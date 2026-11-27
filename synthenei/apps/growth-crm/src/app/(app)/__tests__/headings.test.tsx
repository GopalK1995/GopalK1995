// F29 (AUD-050): heading semantics on the main pages: exactly one h1, none empty, and no skipped levels (h1 -> h3 without an h2).
// Same request-scoped mocks as empty-workspace.test.tsx; the page is invoked as a server component (src/test/empty-harness.tsx).
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
// Integrations resolves its own request context (cookies + session); give it the demo showcase view so the page body renders here.
vi.mock("../integrations/_lib/ctx", () => ({ viewCtx: async () => ({ demo: true }) }));
void [makeCtx, makePrincipal, makeT];

const PAGES: { name: string; load: () => Promise<{ default: (p: never) => unknown }> }[] = [
  { name: "home", load: () => import("../page") },
  { name: "leads", load: () => import("../leads/page") },
  { name: "pipeline", load: () => import("../pipeline/page") },
  { name: "accounts", load: () => import("../accounts/page") },
  { name: "tasks", load: () => import("../tasks/page") },
  { name: "campaigns", load: () => import("../campaigns/page") },
  { name: "analytics", load: () => import("../analytics/page") },
  { name: "integrations", load: () => import("../integrations/page") },
  { name: "settings", load: () => import("../settings/page") },
  { name: "sales", load: () => import("../sales/page") },
];

/** Heading levels in document order, with the text of each h1. */
export function headings(html: string): { level: number; text: string }[] {
  return [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => ({ level: Number(m[1]), text: m[2].replace(/<[^>]+>/g, "").trim() }));
}

for (const mode of ["empty", "demo"] as Mode[]) {
  describe(`${mode} workspace headings`, () => {
    for (const p of PAGES) {
      it(`${p.name}: one h1, no skipped levels`, async () => {
        state.mode = mode;
        const html = await renderPage((await p.load()).default as never);
        const hs = headings(html);
        const h1s = hs.filter((h) => h.level === 1);
        expect(h1s, `h1 count on ${p.name}: ${JSON.stringify(h1s)}`).toHaveLength(1);
        expect(h1s[0].text.length).toBeGreaterThan(0);
        expect(hs[0].level, "the first heading must be the h1").toBe(1);
        let prev = 0;
        for (const h of hs) { expect(h.level, `skipped level before "${h.text}" on ${p.name}`).toBeLessThanOrEqual(prev + 1); prev = h.level; }
      }, 900000);
    }
  });
}
