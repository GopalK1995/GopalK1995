import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

// Skeleton at the final layout: page title, section links, then the request ledger.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading privacy requests">
      <Skeleton className="mb-2 h-4 w-40" />
      <Skeleton className="mb-4 h-7 w-64" />
      <SkeletonRows rows={5} />
    </div>
  );
}
