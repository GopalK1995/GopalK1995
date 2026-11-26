import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

// Skeleton at the final layout so the shell streams first and the page fills in. Decorative; loading.tsx cannot read the locale.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading leads">
      <Skeleton className="mb-2 h-4 w-24" />
      <Skeleton className="mb-4 h-7 w-56" />
      <Skeleton className="mb-4 h-9 w-full max-w-xl" />
      <SkeletonRows rows={10} />
    </div>
  );
}
