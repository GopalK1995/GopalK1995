import { cn } from "@/lib/utils";

type Variant = "block" | "row" | "card" | "chart";
const DIMS: Record<Variant, string> = { block: "", row: "h-9 w-full", card: "h-30 w-full", chart: "h-64 w-full" };

/** Loading = skeleton blocks at final size, no spinners. `variant` gives the common final sizes. */
export const Skeleton = ({ className, variant = "block" }: { className?: string; variant?: Variant }) => (
  <div aria-hidden className={cn("animate-pulse rounded-chip bg-paper-2", DIMS[variant], className)} />
);
/** Table rows at ledger height. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading rows" className={cn("divide-y divide-line", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-9 items-center gap-3 px-2"><Skeleton className="h-3 w-1/4" /><Skeleton className="h-3 w-1/3" /><Skeleton className="ml-auto h-3 w-16" /></div>
      ))}
    </div>
  );
}
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className={cn("rounded-control border border-line p-4", className)}>
      <Skeleton className="mb-3 h-3 w-32" /><Skeleton className="mb-2 h-3 w-full" /><Skeleton className="h-3 w-2/3" />
    </div>
  );
}
export function SkeletonChart({ className }: { className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading chart" className={cn("rounded-control border border-line p-4", className)}>
      <Skeleton className="mb-3 h-3 w-40" /><Skeleton variant="chart" />
    </div>
  );
}
export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-2 h-3 w-40" /><Skeleton className="mb-6 h-7 w-72" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-30" />)}</div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3"><Skeleton className="h-72 lg:col-span-2" /><Skeleton className="h-72" /></div>
    </div>
  );
}
