"use client";
import { useBrand } from "./providers";
import { cn } from "@/lib/utils";

/** Tenant monogram: a scales-of-ledger mark drawn in SVG, coloured from the brand hue. */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" className={cn("shrink-0", className)} aria-hidden>
      <rect width="28" height="28" rx="6" fill="var(--accent)" />
      <path d="M8 8v12h12" fill="none" stroke="var(--accent-ink)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.5 16.5l3-3.5 2.5 2 3-4.5" fill="none" stroke="var(--accent-ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity=".85" />
    </svg>
  );
}
export function BrandName({ collapsed, onNavy = true }: { collapsed?: boolean; onNavy?: boolean }) {
  const { brand } = useBrand();
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <BrandMark />
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <div className={cn("truncate text-[14px] font-semibold tracking-[0.02em]", onNavy ? "text-navy-ink" : "text-ink")}>{brand.name}</div>
          <div className={cn("truncate text-[11px]", onNavy ? "text-navy-ink-3" : "text-ink-3")}>{brand.product}</div>
        </div>
      )}
    </div>
  );
}
