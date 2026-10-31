import { Skeleton } from "@/components/ui/skeleton";

// Skeleton at the final layout: title, tabs, then the notification rows. Decorative; loading.tsx cannot read the locale.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading notifications">
      <Skeleton className="mb-4 h-7 w-48" />
      <Skeleton className="mb-4 h-8 w-64" />
      <div className="space-y-px rounded-control border border-line">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    </div>
  );
}
