import { Skeleton } from "@/components/ui/skeleton";

// Skeleton at the final layout: title, preference table, quiet hours, rules. Decorative; loading.tsx cannot read the locale.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading notification settings">
      <Skeleton className="mb-4 h-7 w-56" />
      <Skeleton className="mb-4 h-56 w-full" />
      <Skeleton className="mb-4 h-24 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
