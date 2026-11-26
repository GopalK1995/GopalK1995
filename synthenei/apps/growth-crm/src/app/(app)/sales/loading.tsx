import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

// Skeleton at the final layout so the shell streams first and the page fills in. Decorative; loading.tsx cannot read the locale.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading sales">
      <Skeleton className="mb-2 h-4 w-24" />
      <Skeleton className="mb-4 h-7 w-56" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-30" />)}</div>
      <SkeletonRows rows={6} className="mt-4" />
    </div>
  );
}
