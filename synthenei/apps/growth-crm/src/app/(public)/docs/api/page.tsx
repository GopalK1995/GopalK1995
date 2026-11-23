import type { Metadata } from "next";
import { loadEnv } from "@/lib/env";
import { buildOpenApi } from "@/lib/api/openapi";

// Public, dependency-free rendering of the /api/v1 OpenAPI 3.1 document (generated in src/lib/api/openapi.ts, served raw at
// /api/v1/openapi.json). This page reads the same builder directly — no network, no client JS, no Swagger/Redoc dependency —
// and lays the paths and schemas out with the app's design tokens, matching the other (public) route-group pages.
export const metadata: Metadata = { title: "API reference" };
export const dynamic = "force-static";

type JsonObj = Record<string, unknown>;
const asObj = (v: unknown): JsonObj => (v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObj) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const METHODS = ["get", "post", "patch", "delete", "put"] as const;
const METHOD_TONE: Record<string, string> = {
  get: "bg-info-soft text-info", post: "bg-success-soft text-success",
  patch: "bg-warn-soft text-warn-ink", delete: "bg-danger-soft text-danger", put: "bg-warn-soft text-warn-ink",
};

interface OpRow { method: string; path: string; summary: string; scope: string | null; params: ParamRow[]; body: boolean; responses: { code: string; desc: string }[] }
interface ParamRow { name: string; where: string; required: boolean; desc: string }

function paramRows(op: JsonObj): ParamRow[] {
  return asArr(op.parameters).map((p) => {
    const o = asObj(p);
    return { name: str(o.name), where: str(o.in), required: Boolean(o.required), desc: str(o.description) };
  });
}
function responseRows(op: JsonObj): { code: string; desc: string }[] {
  return Object.entries(asObj(op.responses)).map(([code, v]) => ({ code, desc: str(asObj(v).description) }));
}

export default function ApiDocsPage() {
  const spec = buildOpenApi(loadEnv().appBaseUrl);
  const info = asObj(spec.info);
  const servers = asArr(spec.servers).map((s) => str(asObj(s).url)).filter(Boolean);
  const scopes = asArr(spec["x-scopes"]).map(str).filter(Boolean);
  const paths = asObj(spec.paths);
  const problemProps = asObj(asObj(asObj(asObj(spec.components).schemas).Problem).properties);
  const codeEnum = asArr(asObj(problemProps.code).enum).map(str);

  // Group operations by tag, preserving the registry order the builder emits.
  const groups: { tag: string; ops: OpRow[] }[] = [];
  const indexOf = (tag: string) => { let g = groups.find((x) => x.tag === tag); if (!g) { g = { tag, ops: [] }; groups.push(g); } return g; };
  for (const [path, item] of Object.entries(paths)) {
    const pit = asObj(item);
    for (const m of METHODS) {
      if (!(m in pit)) continue;
      const op = asObj(pit[m]);
      const tag = str(asArr(op.tags)[0]) || "Other";
      indexOf(tag).ops.push({
        method: m, path, summary: str(op.summary), scope: typeof op["x-required-scope"] === "string" ? (op["x-required-scope"] as string) : null,
        params: paramRows(op), body: "requestBody" in op, responses: responseRows(op),
      });
    }
  }

  return (
    <main className="mx-auto grid max-w-3xl gap-8 px-4 py-10" data-testid="api-docs">
      <header className="grid gap-2">
        <p className="label-caps">API reference</p>
        <h1 className="text-22 font-semibold text-ink">{str(info.title) || "API"}</h1>
        <p className="text-13 text-ink-3">Version {str(info.version) || "1.0.0"} · OpenAPI 3.1</p>
        <p className="text-14 text-ink-2">{str(info.description)}</p>
        {servers.length > 0 && (
          <p className="text-13 text-ink-2">Base URL: <code className="num-mono rounded-chip bg-paper-2 px-1.5 py-0.5 text-ink">{servers[0]}</code></p>
        )}
        <p className="text-13 text-ink-3">
          The machine-readable document is at{" "}
          <a className="font-medium text-accent underline" href="/api/v1/openapi.json">/api/v1/openapi.json</a>.
        </p>
      </header>

      <section className="grid gap-3 rounded-control border border-line bg-surface p-4" aria-labelledby="auth-h">
        <h2 id="auth-h" className="text-15 font-semibold text-ink">Authentication</h2>
        <p className="text-14 text-ink-2">
          Send an API key as a bearer token: <code className="num-mono rounded-chip bg-paper-2 px-1.5 py-0.5 text-ink">Authorization: Bearer sk_live_&lt;prefix&gt;_&lt;secret&gt;</code>
          {" "}(sandbox keys use <code className="num-mono rounded-chip bg-paper-2 px-1.5 py-0.5 text-ink">sk_test_…</code>). Create keys in
          Settings → API keys. A key is bound to a role; its effective permission is the role grant intersected with the key&apos;s scopes,
          and the same authorization as the app applies (RLS). <code className="num-mono">org_id</code> is the public alias of the tenant id.
        </p>
        <p className="text-14 text-ink-2">
          Lists are cursor-paginated (<code className="num-mono">?cursor=</code>, <code className="num-mono">limit ≤ 100</code>) and return a
          <code className="num-mono"> next_cursor</code>. Mutations accept an <code className="num-mono">Idempotency-Key</code> header (replayed
          for 24 h). Errors are <code className="num-mono">application/problem+json</code>.
        </p>
      </section>

      {scopes.length > 0 && (
        <section className="grid gap-3" aria-labelledby="scopes-h">
          <h2 id="scopes-h" className="text-15 font-semibold text-ink">Scopes</h2>
          <ul className="flex flex-wrap gap-1.5">
            {scopes.map((s) => (
              <li key={s} className="num-mono rounded-chip border border-line bg-paper-2 px-2 py-1 text-12 text-ink-2">{s}</li>
            ))}
          </ul>
        </section>
      )}

      {codeEnum.length > 0 && (
        <section className="grid gap-3" aria-labelledby="errs-h">
          <h2 id="errs-h" className="text-15 font-semibold text-ink">Error codes</h2>
          <ul className="flex flex-wrap gap-1.5">
            {codeEnum.map((c) => (
              <li key={c} className="num-mono rounded-chip border border-line bg-paper-2 px-2 py-1 text-12 text-ink-2">{c}</li>
            ))}
          </ul>
          <p className="text-13 text-ink-3">Every endpoint can return 401 (auth), 403 (scope/permission), 404, 409 (conflict / idempotency reuse), 422 (validation) and 429 (rate limit).</p>
        </section>
      )}

      {groups.map((g) => (
        <section key={g.tag} className="grid gap-3" aria-labelledby={`tag-${g.tag}`}>
          <h2 id={`tag-${g.tag}`} className="text-19 font-semibold text-ink">{g.tag}</h2>
          <div className="grid gap-3">
            {g.ops.map((op) => (
              <article key={`${op.method} ${op.path}`} className="grid gap-2 rounded-control border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`num-mono rounded-chip px-2 py-0.5 text-12 font-semibold uppercase ${METHOD_TONE[op.method] ?? "bg-paper-2 text-ink-2"}`}>{op.method}</span>
                  <code className="num-mono text-13 text-ink">{op.path}</code>
                  {op.scope && <span className="num-mono ml-auto rounded-chip border border-line bg-paper-2 px-2 py-0.5 text-12 text-ink-3">scope: {op.scope}</span>}
                </div>
                {op.summary && <p className="text-14 text-ink-2">{op.summary}</p>}
                {op.body && <p className="text-13 text-ink-3">Accepts a JSON request body.</p>}
                {op.params.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[460px] border-collapse text-13">
                      <thead>
                        <tr className="text-left text-ink-3">
                          <th className="label-caps py-1 pr-3 font-normal">Parameter</th>
                          <th className="label-caps py-1 pr-3 font-normal">In</th>
                          <th className="label-caps py-1 font-normal">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {op.params.map((p) => (
                          <tr key={`${p.where}-${p.name}`} className="border-t border-line align-top">
                            <td className="num-mono py-1.5 pr-3 text-ink">{p.name}{p.required && <span className="text-danger"> *</span>}</td>
                            <td className="py-1.5 pr-3 text-ink-2">{p.where}</td>
                            <td className="py-1.5 text-ink-2">{p.desc}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-13 text-ink-3">
                  Responses: {op.responses.map((r) => r.code).join(", ")}
                </p>
              </article>
            ))}
          </div>
        </section>
      ))}

      <footer className="border-t border-line pt-4 text-13 text-ink-3">
        Generated from the live OpenAPI document. See the connector runbooks in <code className="num-mono">docs/connectors/</code> and the
        admin guide in <code className="num-mono">docs/admin-guide.md</code>.
      </footer>
    </main>
  );
}
