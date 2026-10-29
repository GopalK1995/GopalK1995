import { Skeleton } from "@/components/ui/skeleton";

// Skeleton at the final layout: seven stage columns (BUILD-PLAN 3.2). Decorative; the status name is generic English
// because loading.tsx cannot read the locale without a request.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading pipeline">
      <Skeleton className="mb-2 h-4 w-24" />
      <Skeleton className="mb-4 h-7 w-48" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="w-[248px] shrink-0 space-y-2 rounded-control border border-line p-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
