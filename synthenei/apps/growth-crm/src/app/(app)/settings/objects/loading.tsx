import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { ot } from "@/lib/layouts/strings";

// Skeleton at the final layout: page title, toolbar, then the ledger.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label={ot("loading")}>
      <Skeleton className="mb-2 h-4 w-40" />
      <Skeleton className="mb-4 h-7 w-64" />
      <Skeleton className="mb-3 h-8 w-80" />
      <SkeletonRows rows={6} />
    </div>
  );
}
