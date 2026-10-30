import { Skeleton } from "@/components/ui/skeleton";

// Skeleton at the final layout: page title, filter row, then the four list groups. Decorative; loading.tsx cannot read the locale.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading tasks">
      <Skeleton className="mb-2 h-4 w-24" />
      <Skeleton className="mb-4 h-7 w-56" />
      <Skeleton className="mb-4 h-9 w-72" />
      <div className="space-y-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-2 rounded-control border border-line p-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
