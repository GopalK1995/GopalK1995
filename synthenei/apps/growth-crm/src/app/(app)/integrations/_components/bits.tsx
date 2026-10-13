// Server-safe display atoms for integrations: typographic monogram tile (no vendor logos) and direction glyph.
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Direction } from "./meta";

export function Monogram({ text, size = 40, className }: { text: string; size?: number; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-grid shrink-0 place-items-center rounded-sm border border-line-strong bg-paper font-semibold tracking-[-0.03em] text-ink", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * (text.length > 1 ? 0.36 : 0.44)) }}>
      {text}
    </span>
  );
}

const DIR = {
  in: { icon: ArrowDownLeft, label: "Data in" },
  out: { icon: ArrowUpRight, label: "Data out" },
  both: { icon: ArrowLeftRight, label: "Two-way" },
} as const;
export function DirectionTag({ direction, className }: { direction: Direction; className?: string }) {
  const d = DIR[direction];
  return (
    <span className={cn("inline-flex items-center gap-1 text-[12px] text-ink-2", className)}>
      <d.icon className="size-3.5 text-ink-3" aria-hidden />{d.label}
    </span>
  );
}
