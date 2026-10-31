import { SkeletonRows } from "@/components/ui/skeleton";

// Matches the final layout: a list column and a thread column.
export default function Loading() {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface md:grid md:min-h-[480px] md:grid-cols-[288px_minmax(0,1fr)]" aria-busy="true" aria-label="Loading conversations">
      <div className="border-line p-3 md:border-r"><SkeletonRows rows={7} /></div>
      <div className="hidden p-4 md:block"><SkeletonRows rows={5} /></div>
    </div>
  );
}
