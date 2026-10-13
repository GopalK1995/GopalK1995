"use client";
// URL-driven filters: search + selects write to the query string, so server pages filter and links are shareable.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { cn } from "@/lib/utils";

export type FilterDef = { key: string; label: string; options: { value: string; label: string }[] };
export function FilterBar({ filters = [], search, className, children }: { filters?: FilterDef[]; search?: string; className?: string; children?: React.ReactNode }) {
  const router = useRouter(), path = usePathname(), sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [pending, start] = useTransition();
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp.toString());
    if (v) n.set(k, v); else n.delete(k);
    start(() => router.replace(`${path}${n.toString() ? `?${n}` : ""}`, { scroll: false }));
  };
  useEffect(() => { const t = setTimeout(() => { if ((sp.get("q") ?? "") !== q) set("q", q); }, 250); return () => clearTimeout(t); }); // debounce
  const active = filters.filter((f) => sp.get(f.key)).length + (sp.get("q") ? 1 : 0);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", pending && "opacity-70", className)} role="search">
      {search && (
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={search} aria-label={search} className="h-8 w-full rounded-sm border border-line-strong bg-surface pl-8 pr-2 text-[13px] outline-none placeholder:text-ink-3 focus:border-ring" />
        </div>
      )}
      {filters.map((f) => (
        <label key={f.key} className="relative">
          <span className="sr-only">{f.label}</span>
          <select value={sp.get(f.key) ?? ""} onChange={(e) => set(f.key, e.target.value)}
            className={cn("h-8 rounded-sm border bg-surface pl-2.5 pr-7 text-[12px] outline-none focus:border-ring", sp.get(f.key) ? "border-accent text-ink" : "border-line-strong text-ink-2")}>
            <option value="">{f.label}: all</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      ))}
      {children}
      {active > 0 && <button onClick={() => { setQ(""); start(() => router.replace(path, { scroll: false })); }} className="inline-flex h-8 items-center gap-1 rounded-sm px-2 text-[12px] text-ink-3 hover:bg-paper-2 hover:text-ink"><X className="size-3.5" aria-hidden />Clear {active}</button>}
    </div>
  );
}
