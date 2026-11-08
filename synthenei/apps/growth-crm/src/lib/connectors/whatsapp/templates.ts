// Template sync (Meta -> message_templates) and the pure helpers the sender needs: body text, parameter extraction, language mapping.
import type { ProviderTemplate } from "./gateway";
import type { ConnScope, TemplateUpsert, WaDeps } from "./store";

type Comp = { type?: unknown; text?: unknown; language?: unknown };
/** Pseudo component carrying the exact vendor language code (message_templates.language only allows en and ta). */
export const META_LANG = "META_LANG";

export function bodyText(components: unknown[]): string {
  const b = (components as Comp[]).find((c) => String(c.type).toUpperCase() === "BODY");
  return typeof b?.text === "string" ? b.text : "";
}
export function vendorLanguage(components: unknown[], fallback: string): string {
  const m = (components as Comp[]).find((c) => c.type === META_LANG);
  return typeof m?.language === "string" ? m.language : fallback;
}
/** "en", "en_US", "en_GB" -> "en"; "ta" -> "ta"; anything else is not stored (the table only allows en and ta). */
export function localLanguage(code: string): "en" | "ta" | null {
  const base = code.toLowerCase().split(/[_-]/)[0];
  return base === "en" || base === "ta" ? base : null;
}
export const variablesOf = (body: string): string[] => [...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]))].sort((a, b) => Number(a) - Number(b));

export function mapStatus(vendor: string): { status: "draft" | "submitted" | "approved" | "rejected" | "paused"; approval: "showcase" | "pending" | "approved" | "rejected" } {
  switch (vendor.toUpperCase()) {
    case "APPROVED": return { status: "approved", approval: "approved" };
    case "REJECTED": return { status: "rejected", approval: "rejected" };
    case "PAUSED": case "DISABLED": return { status: "paused", approval: "rejected" };
    default: return { status: "submitted", approval: "pending" };   // PENDING, IN_APPEAL, FLAGGED, ...
  }
}
const CATEGORY: Record<string, TemplateUpsert["category"]> = { MARKETING: "marketing", UTILITY: "utility", AUTHENTICATION: "authentication" };

/**
 * Pulls the {{n}} values back out of a message body that was rendered from this template. The inbox stores only the rendered
 * text, so the sender recovers parameters by matching it against the template. Null = the body does not match the template.
 */
export function extractTemplateParams(templateBody: string, rendered: string): string[] | null {
  const tb = templateBody.trim(), text = rendered.trim();
  const parts = tb.split(/\{\{\d+\}\}/);
  const order = [...tb.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  if (!order.length) return text === tb ? [] : null;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${parts.map(esc).join("([\\s\\S]*?)")}$`);
  const m = re.exec(text);
  if (!m) return null;
  const byIndex = new Map<number, string>();
  order.forEach((n, i) => { if (!byIndex.has(n)) byIndex.set(n, m[i + 1]); });
  const max = Math.max(...order);
  const out: string[] = [];
  for (let n = 1; n <= max; n++) { const v = byIndex.get(n); if (v === undefined || v === "") return null; out.push(v); }
  return out;
}

export interface TemplateSyncResult { created: number; updated: number; skipped: number }

/** One page-free pass: upserts every provider template by (integration, provider id). Unsupported languages and name clashes are skipped, counted. */
export async function syncTemplates(deps: Pick<WaDeps, "store">, scope: ConnScope, templates: ProviderTemplate[], reject: (reason: string) => void): Promise<TemplateSyncResult> {
  const out: TemplateSyncResult = { created: 0, updated: 0, skipped: 0 };
  for (const t of templates) {
    const lang = localLanguage(t.language);
    if (!lang) { out.skipped++; reject("unsupported_language"); continue; }
    const body = bodyText(t.components);
    if (!body) { out.skipped++; reject("no_body"); continue; }
    const st = mapStatus(t.status);
    const r = await deps.store.upsertTemplate({
      tenantId: scope.tenantId, workspaceId: scope.workspaceId, connectionId: scope.connectionId, providerTemplateId: t.id, name: t.name, language: lang,
      category: CATEGORY[t.category.toUpperCase()] ?? "utility", status: st.status, body, variables: variablesOf(body),
      components: [...t.components.filter((c) => (c as Comp).type !== META_LANG), { type: META_LANG, language: t.language }], rejectedReason: t.rejectedReason ?? null,
    });
    if (r === "skipped") { out.skipped++; reject("duplicate_language"); } else out[r]++;
  }
  return out;
}
