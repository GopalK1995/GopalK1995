// AUD-016: the client provider ships only the namespaces a route needs. This guard makes sure nothing that calls
// useTranslations("x") renders without "x" in its provider, and that every shipped namespace exists in en and resolves in ta.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { APP_NS, SECTION_NS, pickNamespaces } from "../namespaces";
import { BASE } from "../registry";
import { messagesFor } from "../layering";

const SRC = join(__dirname, "..", "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "__tests__" || n === "node_modules") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs)$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(SRC, p).split(sep).join("/");
const nsOf = (src: string) => [...src.matchAll(/useTranslations\(\s*["']([\w-]+)["']\s*\)/g)].map((m) => m[1]);
const files = walk(SRC).map((p) => ({ path: rel(p), src: readFileSync(p, "utf8") })).filter((f) => !f.path.startsWith("i18n/")); // the i18n module itself only mentions the hook in comments
const APP = "app/(app)/";

function provided(path: string): readonly string[] {
  if (path.startsWith(APP)) return [...APP_NS, ...(SECTION_NS[path.slice(APP.length).split("/")[0]] ?? [])];
  if (path.startsWith("components/") || path.startsWith("lib/")) return APP_NS; // shared: rendered inside the signed-in shell
  return []; // login, auth/*, admin, legal, docs, g/*: no provider, so no client component there may read messages
}

describe("client i18n namespaces per route (AUD-016)", () => {
  it("every useTranslations namespace is provided where the component lives", () => {
    const bad = files.flatMap((f) => nsOf(f.src).filter((n) => !provided(f.path).includes(n)).map((n) => `${f.path}: "${n}" not in [${provided(f.path).join(",")}]`));
    expect(bad).toEqual([]);
  });

  it("a section that imports a client component from another section provides that component's namespaces too", () => {
    const find = (base: string) => files.find((f) => [".tsx", ".ts", "/index.tsx", "/index.ts"].some((e) => f.path === base + e));
    const bad: string[] = [];
    for (const f of files.filter((x) => x.path.startsWith(APP))) {
      const dir = f.path.split("/").slice(0, -1);
      for (const m of f.src.matchAll(/from\s+["']((?:@\/app\/\(app\)\/|\.\.?\/)[^"']+)["']/g)) {
        const spec = m[1];
        const target = spec.startsWith("@/app/") ? spec.slice(2) : join(...dir, spec).split(sep).join("/");
        const dep = find(target);
        if (!dep) continue;
        for (const n of nsOf(dep.src)) if (!provided(f.path).includes(n)) bad.push(`${f.path} imports ${dep.path} which needs "${n}"`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("each section layout wires the namespaces declared for it", () => {
    for (const [seg, extra] of Object.entries(SECTION_NS)) {
      const layout = files.find((f) => f.path === `${APP}${seg}/layout.tsx`);
      expect(layout, `missing layout for ${seg}`).toBeTruthy();
      for (const n of extra) expect(layout!.src).toContain(`"${n}"`);
    }
  });

  it("every declared namespace exists in English and resolves in Tamil (English fills gaps), so none can be missing at runtime", () => {
    const all = new Set<string>([...APP_NS, ...Object.values(SECTION_NS).flat()]);
    const en = messagesFor("en"), ta = messagesFor("ta");
    for (const n of all) {
      expect(BASE.en[n], `en/${n}.json`).toBeTruthy();
      expect(Object.keys(pickNamespaces(en, [n])), `en ${n}`).toEqual([n]);
      expect(Object.keys(pickNamespaces(ta, [n])), `ta ${n}`).toEqual([n]);
      expect(Object.keys(ta[n] as object).length).toBeGreaterThanOrEqual(Object.keys(en[n] as object).length);
    }
  });

  it("the signed-in client payload is a small fraction of the catalogue", () => {
    const size = (m: object) => JSON.stringify(m).length;
    const full = messagesFor("en");
    expect(size(pickNamespaces(full, APP_NS))).toBeLessThan(size(full) / 2);
  });
});
