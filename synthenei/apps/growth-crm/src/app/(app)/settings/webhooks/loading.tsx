import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { wh } from "./_lib/strings";

// Skeleton at the final layout: page title, then the endpoint ledger.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label={wh("loading")}>
      <Skeleton className="mb-2 h-4 w-40" />
      <Skeleton className="mb-4 h-7 w-64" />
      <SkeletonRows rows={4} />
    </div>
  );
}
