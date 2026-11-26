"use client";
// Collapsed-sidebar "Sample data" marker: a real, focusable, named control (A11Y-019). The tooltip repeats the name for sighted hover.
import { Tip } from "@/components/ui/tooltip";

export function SampleDataDot({ label }: { label: string }) {
  return (
    <Tip content={label} side="right">
      <button type="button" aria-label={label} className="mx-auto grid size-6 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span aria-hidden className="block size-2 rounded-full bg-chart-2" />
      </button>
    </Tip>
  );
}
