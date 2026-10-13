"use client";
// Category filter + card grid. Featured connectors (the ones the demo story depends on) get wider cards;
// the rest are compact rows. Filter state lives in the URL (?cat=) so a filtered view can be shared.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { StatusChip } from "@/components/ui/badge";
import { EASE } from "@/components/ui/motion";
import { cn } from "@/lib/utils";
import { Monogram, DirectionTag } from "./bits";
import type { Direction } from "./meta";

export type GridItem = {
  id: string; name: string; vendor: string; category: string; monogram: string; featured: boolean; direction: Direction;
  status: "showcase" | "connected" | "needs_attention" | "error" | "not_configured"; statusLabel: string;
  value: string; trigger: string; lastSync: string | null; rows24h: number | null;
};

export function IntegrationGrid({ items, categories }: { items: GridItem[]; categories: readonly string[] }) {
  const sp = useSearchParams(), router = useRouter(), path = usePathname();
  const reduce = useReducedMotion();
  const cat = sp.get("cat") ?? "All";
  const set = (c: string) => {
    const n = new URLSearchParams(sp.toString());
    if (c === "All") n.delete("cat"); else n.set("cat", c);
    router.replace(`${path}${n.toString() ? `?${n}` : ""}`, { scroll: false });
  };
  const counts = Object.fromEntries(categories.map((c) => [c, items.filter((i) => i.category === c).length]));
  const shown = cat === "All" ? items : items.filter((i) => i.category === cat);
  const featured = shown.filter((i) => i.featured), rest = shown.filter((i) => !i.featured);

  return (
    <div>
      <div role="group" aria-label="Filter by category" className="scrollbar-thin -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {["All", ...categories].map((c) => {
          const on = c === cat;
          return (
            <button key={c} type="button" aria-pressed={on} onClick={() => set(c)}
              className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm border px-3 text-[12px] font-medium transition-colors duration-150",
                on ? "border-navy-900 bg-navy-900 text-navy-ink" : "border-line-strong bg-surface text-ink-2 hover:bg-paper-2 hover:text-ink")}>
              {c}<span className={cn("num text-[11px]", on ? "text-navy-ink-3" : "text-ink-3")}>{c === "All" ? items.length : counts[c]}</span>
            </button>
          );
        })}
      </div>

      {featured.length > 0 && (
        <ul className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <AnimatePresence initial={false}>
            {featured.map((it, idx) => (
              <motion.li key={it.id} layout={!reduce} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: EASE }}
                className={cn("min-w-0", idx < 2 ? "xl:col-span-3" : "xl:col-span-2")}>
                <FeaturedCard it={it} large={idx < 2} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {rest.length > 0 && (
        <section aria-label={featured.length ? "Other connectors" : "Connectors"}>
          {featured.length > 0 && <h2 className="eyebrow mb-2">Other connectors</h2>}
          <ul className="grid overflow-hidden rounded-md border border-line bg-surface shadow-1 md:grid-cols-2 xl:grid-cols-3">
            {rest.map((it) => (
              <li key={it.id} className="-mb-px -mr-px min-w-0 border-b border-r border-line"><CompactRow it={it} /></li>
            ))}
            {cat === "All" && (
              <li className="-mb-px -mr-px min-w-0 border-b border-r border-line bg-paper/60 p-4">
                <h3 className="text-[13px] font-semibold text-ink">Need another platform?</h3>
                <p className="mt-1 text-[12px] leading-[18px] text-ink-2">CSV import works for any export today. For tools we have not built, Zapier or Make can post to the signed create-lead endpoint.</p>
              </li>
            )}
          </ul>
        </section>
      )}
      {!shown.length && <p className="rounded-md border border-dashed border-line-strong px-4 py-8 text-center text-[13px] text-ink-2">No connectors in {cat}. Choose All to see every connector.</p>}
    </div>
  );
}

function Sync({ it, onNavy }: { it: GridItem; onNavy?: boolean }) {
  return (
    <span className={cn("text-[12px] num", onNavy ? "text-navy-ink-3" : "text-ink-3")}>
      {it.lastSync ? <>Sample sync {it.lastSync}{it.rows24h !== null && <> · {it.rows24h} rows in 24 h</>}</> : "No sync yet"}
    </span>
  );
}

function FeaturedCard({ it, large }: { it: GridItem; large: boolean }) {
  return (
    <Link href={`/integrations/${it.id}`}
      className="group flex h-full min-w-0 flex-col rounded-md border border-line bg-surface p-4 shadow-1 outline-none transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-2 focus-visible:border-ring sm:p-5">
      <div className="flex items-start gap-3">
        <Monogram text={it.monogram} size={large ? 48 : 40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className={cn("font-semibold text-ink", large ? "text-[16px]" : "text-[14px]")}>{it.name}</h3>
            <StatusChip status={it.status} label={it.statusLabel} />
          </div>
          <p className="mt-0.5 text-[12px] text-ink-3">{it.vendor} · {it.category}</p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
      </div>
      <p className={cn("mb-4 mt-3 text-ink-2", large ? "text-[14px] leading-6" : "text-[13px] leading-5")}>{it.value}</p>
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3">
        <DirectionTag direction={it.direction} />
        <span className="text-[12px] text-ink-2">{it.trigger}</span>
        <span className="sm:ml-auto"><Sync it={it} /></span>
      </div>
    </Link>
  );
}

function CompactRow({ it }: { it: GridItem }) {
  return (
    <Link href={`/integrations/${it.id}`} className="group flex h-full min-w-0 items-start gap-3 p-4 outline-none transition-colors duration-150 hover:bg-paper focus-visible:bg-paper">
      <Monogram text={it.monogram} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-[13px] font-semibold text-ink">{it.name}</h3>
          <StatusChip status={it.status} label={it.statusLabel} />
        </div>
        <p className="mt-1 line-clamp-2 text-[12px] leading-[18px] text-ink-2">{it.value}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1"><DirectionTag direction={it.direction} /><span className="text-[12px] text-ink-3">{it.category}</span></div>
      </div>
    </Link>
  );
}
