import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import en from "../../../../../messages/en/settings-access.json";

// Skeleton at the final layout: page title, tab bar, then the members ledger. Decorative; loading.tsx cannot read the locale.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label={en.loading}>
      <Skeleton className="mb-2 h-4 w-40" />
      <Skeleton className="mb-4 h-7 w-64" />
      <Skeleton className="mb-4 h-9 w-72" />
      <SkeletonRows rows={6} />
    </div>
  );
}
