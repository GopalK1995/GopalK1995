import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <section className={cn("min-w-0 rounded-control border border-line bg-surface", className)} {...p} />;
}
export function CardHeader({ title, sub, action, className, eyebrow }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; className?: string; eyebrow?: ReactNode }) {
  return (
    <header className={cn("flex items-start justify-between gap-3 px-4 pt-4 pb-3 sm:px-5", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h2 className="text-[14px] font-semibold leading-5 text-ink">{title}</h2>
        {sub && <p className="mt-0.5 text-[12px] leading-4 text-ink-3">{sub}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </header>
  );
}
export function CardBody({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pb-4 sm:px-5 sm:pb-5", className)} {...p} />;
}
/** Navy "key panel" (the 30% structure colour used for the one panel that matters most on a page). */
export function NavyPanel({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <section className={cn("min-w-0 rounded-control bg-navy-900 text-navy-ink", className)} {...p} />;
}
