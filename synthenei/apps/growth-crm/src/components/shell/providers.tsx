"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { DealStage, Role } from "@/lib/data/types";
import { DEAL_STAGES } from "@/lib/data/metrics";
import { TipProvider } from "@/components/ui/tooltip";
import { MotionConfig } from "motion/react";
import { FONT_STACKS, fontsFor, vocabFor, type TenantConfigOverrides, type Vertical, type Vocab } from "@/lib/vertical";

/** What client components know about the viewer: identity, active workspace and the role held there. */
export interface ShellCtx {
  uid: string; name: string; email: string; demo: boolean; platformAdmin: boolean; role: Role;
  ws: { id: string; name: string; region: string }; tenant: { id: string; name: string; product: string; hue: number; monogram: string; vertical: Vertical; workspaceCount: number; isPrimaryOwner: boolean; /** Effective tenant config for vocabFor()/fontsFor() on the client. */ config?: TenantConfigOverrides; /** Stage ids in the tenant's configured order. */ stageOrder?: { lead: string[]; deal: string[] } };
  workspaces: { id: string; name: string; tenantId: string; tenantName: string; monogram: string; role: Role }[];
  support: { mode: "read_only" | "read_write"; reason: string; admin: string; endsAt: number } | null;
}
const SessionCtx = createContext<ShellCtx | null>(null);
export const useSession = () => {
  const s = useContext(SessionCtx);
  if (!s) throw new Error("useSession outside provider");
  return s;
};

/** Deal stage ids in the tenant's configured order (pipeline board columns). */
export const useDealStages = (): DealStage[] => { const o = useSession().tenant.stageOrder?.deal; return (o && o.length === DEAL_STAGES.length ? o : DEAL_STAGES) as DealStage[]; };
/** Industry vocabulary for the active tenant (client components). */
export const useVocab = (): Vocab => vocabFor(useSession().tenant);

/** White-label branding. Stored per browser for the demo (a real tenant stores it in `tenants.brand_*`). */
export type Brand = { name: string; product: string; hue: number; /** Keys into FONT_STACKS (allow-list); "default" = built-in fonts. */ fonts?: { heading: string; body: string } };
export const DEFAULT_BRAND: Brand = { name: "LAWSOME", product: "Growth CRM", hue: 245 };
export const BRAND_KEY = "gcrm-brand"; // per tenant: `${BRAND_KEY}:${tenantId}`
const BrandCtx = createContext<{ brand: Brand; setBrand: (b: Partial<Brand>) => void; reset: () => void }>({ brand: DEFAULT_BRAND, setBrand: () => {}, reset: () => {} });
export const useBrand = () => useContext(BrandCtx);

/** Brand now comes from the tenant config (server-rendered), so there is nothing to restore before paint. */
export const brandBootScript = "";

export function Providers({ session, children }: { session: ShellCtx; children: ReactNode }) {
  const f = fontsFor(session.tenant);
  const brand = useMemo<Brand>(() => ({ name: session.tenant.name, product: session.tenant.product, hue: session.tenant.hue, fonts: f }), [session.tenant.name, session.tenant.product, session.tenant.hue, f.heading, f.body]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.documentElement.style.setProperty("--brand-h", String(brand.hue)); }, [brand.hue]);
  const fh = brand.fonts?.heading ?? "default", fb = brand.fonts?.body ?? "default";
  useEffect(() => {
    const r = document.documentElement.style;
    if (FONT_STACKS[fb]) r.setProperty("--font-ui", FONT_STACKS[fb]); else r.removeProperty("--font-ui");
    if (FONT_STACKS[fh]) r.setProperty("--font-heading", FONT_STACKS[fh]); else r.removeProperty("--font-heading");
  }, [fh, fb]);
  const setBrand = useCallback(() => {}, []); // legacy API: branding is saved through Settings -> Configuration
  const reset = useCallback(() => {}, []);
  return (
    <SessionCtx.Provider value={session}>
      <BrandCtx.Provider value={{ brand, setBrand, reset }}>
        <MotionConfig reducedMotion="user"><TipProvider delayDuration={200}>{children}</TipProvider></MotionConfig>
      </BrandCtx.Provider>
    </SessionCtx.Provider>
  );
}
