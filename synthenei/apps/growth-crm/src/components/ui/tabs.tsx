"use client";
import * as T from "@radix-ui/react-tabs";
import { motion, useReducedMotion } from "motion/react";
import { useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { rovingTarget } from "./roving";

export function Tabs({ tabs, defaultValue, className, onChange }: { tabs: { value: string; label: ReactNode; content: ReactNode }[]; defaultValue?: string; className?: string; onChange?: (v: string) => void }) {
  const [val, setVal] = useState(defaultValue ?? tabs[0].value);
  const id = useId();
  const reduce = useReducedMotion();
  return (
    <T.Root value={val} onValueChange={(v) => { setVal(v); onChange?.(v); }} className={className}>
      <T.List className="scrollbar-thin -mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        {tabs.map((t) => (
          <T.Trigger key={t.value} value={t.value} className={cn("relative h-10 shrink-0 px-3 text-[13px] font-medium text-ink-3 focus-ring-inset transition-colors hover:text-ink data-[state=active]:text-ink")}>
            {t.label}
            {val === t.value && (
              <motion.span layoutId={`tab-${id}`} className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" transition={reduce ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }} />
            )}
          </T.Trigger>
        ))}
      </T.List>
      {tabs.map((t) => <T.Content key={t.value} value={t.value} className="focus-ring">{t.content}</T.Content>)}
    </T.Root>
  );
}

/** Segmented control for toggles like first/last touch. WAI-ARIA radiogroup: one tab stop, arrow keys move and select. */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const sel = options.findIndex((o) => o.value === value);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const j = rovingTarget(e.key, i, options.length);
    if (j < 0) return;
    e.preventDefault();
    refs.current[j]?.focus();
    onChange(options[j].value);
  };
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-8 items-center rounded-sm border border-line-strong bg-paper-2 p-0.5">
      {options.map((o, i) => (
        <button key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={value === o.value} tabIndex={value === o.value || (sel < 0 && i === 0) ? 0 : -1}
          onClick={() => onChange(o.value)} onKeyDown={(e) => onKey(e, i)}
          className={cn("h-full rounded-[4px] px-2.5 text-[12px] font-medium focus-ring-inset transition-colors", value === o.value ? "bg-surface text-ink shadow-1" : "text-ink-3 hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
