import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { ak } from "./_lib/strings";

// Skeleton at the final layout: page title, then the key ledger.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label={ak("loading")}>
      <Skeleton className="mb-2 h-4 w-40" />
      <Skeleton className="mb-4 h-7 w-64" />
      <SkeletonRows rows={5} />
    </div>
  );
}
