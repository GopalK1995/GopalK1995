import { ShieldOff } from "lucide-react";
import type { ReactNode } from "react";

/** Permission-denied state for a console section: says which permission is missing and what to do. */
export function Denied({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="status" className="zone-decision flex flex-col items-start gap-1 rounded-control border border-line-strong bg-paper-2">
      <ShieldOff className="mb-1 size-4 text-ink-3" strokeWidth={1.75} aria-hidden />
      <p className="text-15 font-bold tracking-[-0.015em] text-ink">{title}</p>
      {children && <p className="max-w-prose text-13 text-ink-2">{children}</p>}
    </div>
  );
}
