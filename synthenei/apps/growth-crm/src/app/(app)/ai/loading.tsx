import { Skeleton } from "@/components/ui/skeleton";

// Skeleton at the final layout so the shell streams first and the page fills in. Decorative; loading.tsx cannot read the locale.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading assistant">
      <Skeleton className="mb-2 h-4 w-24" />
      <Skeleton className="mb-4 h-7 w-56" />
      <Skeleton className="mb-3 h-24 w-full" /><Skeleton className="h-24 w-full" />
    </div>
  );
}
