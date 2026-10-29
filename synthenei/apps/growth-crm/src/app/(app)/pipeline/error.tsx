"use client";
import { ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { PIPELINE_BASE, fill } from "./_lib/labels";

// Route error boundary: names the failing source and offers retry. Client side, so it reads the English draft;
// the page itself renders locale-aware labels.
export default function PipelineError({ reset }: { error: Error; reset: () => void }) {
  const L = PIPELINE_BASE.en;
  return <ErrorState source={L.errorSource} message={fill(L.errorMessage, { deals: "deals" })} retry={<Button variant="secondary" onClick={reset}>{L.retry}</Button>} />;
}
