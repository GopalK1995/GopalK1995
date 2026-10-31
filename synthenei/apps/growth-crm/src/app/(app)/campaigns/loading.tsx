import { Skeleton } from "@/components/ui/skeleton";

// Skeleton at the final layout: title, summary row, table. Decorative; loading.tsx cannot read the locale.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading campaigns">
      <Skeleton className="mb-2 h-4 w-24" />
      <Skeleton className="mb-4 h-7 w-56" />
      <Skeleton className="mb-4 h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
