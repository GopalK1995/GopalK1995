import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { emText } from "@/lib/connectors/email/strings";

// Skeleton at the final layout: page title, then the identity form and the domain ledger.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label={emText("en", "loading")}>
      <Skeleton className="mb-2 h-4 w-40" />
      <Skeleton className="mb-4 h-7 w-64" />
      <SkeletonRows rows={5} />
    </div>
  );
}
