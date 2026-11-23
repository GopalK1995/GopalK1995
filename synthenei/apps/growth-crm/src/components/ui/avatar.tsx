import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

// Text is always `text-ink` (the app's standard dark foreground), not the tone's own chart hue: raw chart colors are
// tuned for data-viz against a plain page background, not against their own translucent tint, and axe's color-contrast
// check flagged several of these pairings as failing on a light tint. Background tint still varies per tone for
// visual distinction between avatars; only the text pairing needed to change.
const TONES = ["bg-chart-1/12 text-ink", "bg-chart-3/15 text-ink", "bg-chart-4/12 text-ink", "bg-navy-900/8 text-ink", "bg-chart-3/14 text-ink"];
export function Avatar({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span aria-hidden className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold", TONES[h % TONES.length], className)} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
      {initials(name)}
    </span>
  );
}
