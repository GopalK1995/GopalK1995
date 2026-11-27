// Brand for pages shown before sign-in (login, /g/<slug>): resolved from the tenants table by slug or custom domain through the
// anon-callable tenant_branding() RPC (no personal data). No customer name lives in code: an unknown slug or host is "not found",
// and a visit with no tenant at all gets the neutral platform brand. Demo fixtures are used only by the caller, in demo/dev.
import "server-only";
import { createSupabaseServerClient, supabaseConfigured } from "@/lib/supabase/server";
import { platformProduct } from "./platform";

export interface PublicBrand {
  source: "db" | "platform";
  slug: string | null;
  name: string;
  monogram: string;
  hue: number;
  logoUrl: string | null;
}
export interface BrandRow { slug?: unknown; brand_name?: unknown; brand_logo_url?: unknown; brand_primary?: unknown }

const HEX = /^#[0-9a-f]{6}$/i;
/** Hue (0-360) of a #rrggbb colour, for the --brand-h token. Anything else falls back to the default hue. */
export function hueFromHex(hex: unknown, fallback = 245): number {
  if (typeof hex !== "string" || !HEX.test(hex)) return fallback;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (d === 0) return fallback;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(((h * 60) + 360) % 360);
}
const safeLogo = (u: unknown): string | null => (typeof u === "string" && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null);
const monogramOf = (name: string): string => (Array.from(name.trim())[0] ?? "?").toUpperCase();

export function brandFromRow(row: BrandRow): PublicBrand | null {
  const name = typeof row.brand_name === "string" ? row.brand_name.trim() : "";
  if (!name) return null;
  return { source: "db", slug: typeof row.slug === "string" ? row.slug : null, name, monogram: monogramOf(name), hue: hueFromHex(row.brand_primary), logoUrl: safeLogo(row.brand_logo_url) };
}
/** Host header to the bare lowercase hostname (no port). */
export const hostOnly = (host: string | null | undefined): string | null => {
  const h = (host ?? "").split(",")[0]!.trim().toLowerCase().replace(/:\d+$/, "");
  return h && /^[a-z0-9.-]+$/.test(h) ? h : null;
};
/** Brand shown when no tenant is identified: the configured platform product, or a neutral word. */
export function platformBrand(): PublicBrand {
  const name = platformProduct() ?? "Sign in";
  return { source: "platform", slug: null, name, monogram: platformProduct() ? monogramOf(name) : "·", hue: 245, logoUrl: null };
}

/** Tenant by slug or custom domain, or null (unknown, inactive, no backend, or any failure: never throws). */
export async function resolvePublicBrand(q: { slug?: string | null; host?: string | null }): Promise<PublicBrand | null> {
  const slug = q.slug && /^[a-z0-9][a-z0-9-]{0,62}$/.test(q.slug) ? q.slug : null;
  const domain = hostOnly(q.host);
  if (!slug && !domain) return null;
  if (!supabaseConfigured()) return null;
  try {
    const sb = await createSupabaseServerClient();
    if (!sb) return null;
    const { data, error } = await (sb as unknown as { rpc(fn: string, a: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> })
      .rpc("tenant_branding", { p_slug: slug, p_domain: domain });
    if (error) return null;
    const row = (Array.isArray(data) ? data[0] : data) as BrandRow | null | undefined;
    return row ? brandFromRow(row) : null;
  } catch { return null; }
}
