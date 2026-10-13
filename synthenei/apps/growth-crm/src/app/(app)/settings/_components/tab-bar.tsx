"use client";
// URL-addressed tabs (/settings?tab=users). Roving focus with arrow keys, Home/End; activation follows focus.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { useRef, useTransition } from "react";
import { EASE } from "@/components/ui/motion";
import { cn } from "@/lib/utils";

export function TabBar({ tabs, current }: { tabs: { value: string; label: string }[]; current: string }) {
  const router = useRouter(), path = usePathname(), sp = useSearchParams();
  const reduce = useReducedMotion();
  const [pending, start] = useTransition();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const go = (v: string) => {
    const n = new URLSearchParams(sp.toString());
    n.delete("q"); n.delete("actor"); n.delete("kind");
    n.set("tab", v);
    start(() => router.replace(`${path}?${n}`, { scroll: false }));
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const last = tabs.length - 1;
    const j = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (j < 0) return;
    e.preventDefault();
    refs.current[j]?.focus();
    go(tabs[j].value);
  };
  return (
    <div role="tablist" aria-label="Settings sections" className={cn("scrollbar-thin -mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0", pending && "opacity-80")}>
      {tabs.map((t, i) => {
        const on = t.value === current;
        return (
          <button key={t.value} ref={(el) => { refs.current[i] = el; }} role="tab" id={`tab-${t.value}`} aria-selected={on} aria-controls={`panel-${t.value}`} tabIndex={on ? 0 : -1}
            onClick={() => go(t.value)} onKeyDown={(e) => onKey(e, i)}
            className={cn("relative h-10 shrink-0 px-3 text-[13px] font-medium outline-none transition-colors duration-150 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring", on ? "text-ink" : "text-ink-3 hover:text-ink")}>
            {t.label}
            {on && <motion.span layoutId="settings-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" transition={reduce ? { duration: 0 } : { duration: 0.2, ease: EASE }} />}
          </button>
        );
      })}
    </div>
  );
}
