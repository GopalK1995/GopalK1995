import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONES = ["bg-chart-1/12 text-chart-1", "bg-chart-3/15 text-[color:var(--warn-ink)]", "bg-chart-4/12 text-chart-4", "bg-navy-900/8 text-navy-800", "bg-chart-3/14 text-chart-3"];
export function Avatar({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span aria-hidden className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold", TONES[h % TONES.length], className)} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
      {initials(name)}
    </span>
  );
}
