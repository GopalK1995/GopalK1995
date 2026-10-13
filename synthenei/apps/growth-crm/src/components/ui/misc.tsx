import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, sub, actions, eyebrow, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.02em] text-ink sm:text-[24px] sm:leading-8">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-[13px] leading-5 text-ink-2">{sub}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ScoreChip({ score, className }: { score: number; className?: string }) {
  const band = score >= 70 ? "hot" : score >= 40 ? "warm" : "cool"; // bands per spec M51: 0–39 / 40–69 / 70–100
  return (
    <span className={cn("inline-flex h-5 min-w-9 items-center justify-center gap-1 rounded-[4px] px-1.5 text-[11px] font-semibold num ring-1 ring-inset",
      band === "hot" ? "bg-accent text-accent-ink ring-accent" : band === "warm" ? "bg-accent-soft text-accent-strong ring-accent/25" : "bg-paper-2 text-ink-3 ring-line", className)}
      title={`Lead score ${score} / 100 (${band})`}>
      {score}
    </span>
  );
}

/** Thin horizontal meter, used inside table cells and lists. */
export function Meter({ value, max = 1, className, tone = "accent" }: { value: number; max?: number; className?: string; tone?: "accent" | "warn" | "danger" | "success" | "navy" }) {
  const w = Math.max(0, Math.min(1, value / max)) * 100;
  const c = { accent: "bg-accent", warn: "bg-warn", danger: "bg-danger", success: "bg-success", navy: "bg-navy-700" }[tone];
  return <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-paper-2", className)}><div className={cn("h-full rounded-full", c)} style={{ width: `${w}%` }} /></div>;
}

export function Dl({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[minmax(96px,auto)_1fr] gap-x-4 gap-y-2 text-[13px]", className)}>
      {items.map(([k, v], i) => (<div key={i} className="contents"><dt className="text-ink-3">{k}</dt><dd className="min-w-0 text-ink">{v}</dd></div>))}
    </dl>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="rounded-md border border-dashed border-line-strong px-4 py-8 text-center"><p className="text-[13px] font-medium text-ink">{title}</p>{children && <p className="mt-1 text-[12px] text-ink-3">{children}</p>}</div>;
}

export const th = "h-9 px-3 text-left text-[11px] font-medium uppercase tracking-[0.05em] text-ink-3 whitespace-nowrap";
export const thNum = th + " text-right";
export const td = "h-11 px-3 text-[13px] text-ink whitespace-nowrap";
export const tdNum = td + " text-right num";
export function Table({ children, className, minWidth = 720 }: { children: ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className={cn("scrollbar-thin overflow-x-auto", className)}>
      <table className="w-full border-collapse" style={{ minWidth }}>{children}</table>
    </div>
  );
}
