// Merge-field rendering. {{field}} and {{field|fallback}}; names are lowercase letters, digits and underscores (or a bare number for
// provider-style {{1}}). HTML output escapes every substituted value, text output does not. A field with no value and no fallback is
// reported in `missing`: the sender blocks the message instead of sending "Hello ,".
export type MergeData = Record<string, string | number | null | undefined>;
export interface Rendered { text: string; missing: string[] }

const FIELD = /\{\{\s*([a-z0-9_]{1,40})\s*(?:\|([^{}]{0,80}))?\}\}/g;
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);

export function renderMerge(template: string, data: MergeData, mode: "html" | "text"): Rendered {
  const missing = new Set<string>();
  const text = template.replace(FIELD, (_m, name: string, fallback: string | undefined) => {
    const raw = data[name];
    const v = raw === null || raw === undefined || String(raw).trim() === "" ? (fallback ?? null) : String(raw);
    if (v === null) { missing.add(name); return ""; }
    return mode === "html" ? escapeHtml(v) : v.replace(/[\r\n]+/g, " ");
  });
  return { text, missing: [...missing] };
}
/** Names a template uses, for the editor and for validation before a campaign starts. */
export function mergeFieldsOf(template: string): string[] {
  const s = new Set<string>();
  for (const m of template.matchAll(FIELD)) s.add(m[1]);
  return [...s];
}
/** Plain-text twin of an HTML body for the text/plain alternative. */
export function htmlToText(html: string): string {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li|tr)>/gi, "\n").replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim();
}
