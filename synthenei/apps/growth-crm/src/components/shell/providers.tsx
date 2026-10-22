"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Role } from "@/lib/data/types";
import { TipProvider } from "@/components/ui/tooltip";
import { MotionConfig } from "motion/react";
import { vocabFor, type Vertical, type Vocab } from "@/lib/vertical";

/** What client components know about the viewer: identity, active workspace and the role held there. */
export interface ShellCtx {
  uid: string; name: string; email: string; demo: boolean; platformAdmin: boolean; role: Role;
  ws: { id: string; name: string; region: string }; tenant: { id: string; name: string; product: string; hue: number; monogram: string; vertical: Vertical; workspaceCount: number; isPrimaryOwner: boolean };
  workspaces: { id: string; name: string; tenantId: string; tenantName: string; monogram: string; role: Role }[];
  support: { mode: "read_only" | "read_write"; reason: string; admin: string; endsAt: number } | null;
}
const SessionCtx = createContext<ShellCtx | null>(null);
export const useSession = () => {
  const s = useContext(SessionCtx);
  if (!s) throw new Error("useSession outside provider");
  return s;
};

/** Industry vocabulary for the active tenant (client components). */
export const useVocab = (): Vocab => vocabFor(useSession().tenant);

/** White-label branding. Stored per browser for the demo (a real tenant stores it in `tenants.brand_*`). */
export type Brand = { name: string; product: string; hue: number };
export const DEFAULT_BRAND: Brand = { name: "LAWSOME", product: "Growth CRM", hue: 245 };
export const BRAND_KEY = "gcrm-brand"; // per tenant: `${BRAND_KEY}:${tenantId}`
const BrandCtx = createContext<{ brand: Brand; setBrand: (b: Partial<Brand>) => void; reset: () => void }>({ brand: DEFAULT_BRAND, setBrand: () => {}, reset: () => {} });
export const useBrand = () => useContext(BrandCtx);

/** Runs before paint (inlined in <head>) so a saved hue never flashes the default. */
export const brandBootScript = `try{var t=document.documentElement.dataset.tenant;var b=t&&JSON.parse(localStorage.getItem("${BRAND_KEY}:"+t)||"null");if(b&&typeof b.hue==="number")document.documentElement.style.setProperty("--brand-h",String(b.hue))}catch(e){}`;

export function Providers({ session, children }: { session: ShellCtx; children: ReactNode }) {
  const tenantBrand: Brand = { name: session.tenant.name, product: session.tenant.product, hue: session.tenant.hue };
  const key = `${BRAND_KEY}:${session.tenant.id}`;
  const [brand, set] = useState<Brand>(tenantBrand);
  useEffect(() => {
    try { const b = JSON.parse(localStorage.getItem(key) || "null"); set(b ? { ...tenantBrand, ...b } : tenantBrand); } catch { /* storage blocked */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { document.documentElement.style.setProperty("--brand-h", String(brand.hue)); }, [brand.hue]);
  const setBrand = useCallback((p: Partial<Brand>) => set((b) => {
    const n = { ...b, ...p };
    try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* ignore */ }
    return n;
  }), [key]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reset = useCallback(() => { try { localStorage.removeItem(key); } catch { /* ignore */ } set(tenantBrand); }, [key]);
  return (
    <SessionCtx.Provider value={session}>
      <BrandCtx.Provider value={{ brand, setBrand, reset }}>
        <MotionConfig reducedMotion="user"><TipProvider delayDuration={200}>{children}</TipProvider></MotionConfig>
      </BrandCtx.Provider>
    </SessionCtx.Provider>
  );
}
