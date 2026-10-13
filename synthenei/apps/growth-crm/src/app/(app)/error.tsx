"use client";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Page-level error state: names the failing source, offers Retry, never falls back to sample data. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-12 max-w-lg rounded-md border border-danger/25 bg-surface p-5 shadow-1">
      <div className="flex items-center gap-2 text-[14px] font-semibold text-danger"><TriangleAlert className="size-4" aria-hidden />This page could not load its data</div>
      <p className="mt-2 text-[13px] text-ink-2">{error.message || "The data source returned an error."}</p>
      {error.digest && <p className="mt-1 font-mono text-[11px] text-ink-3">Error id {error.digest}</p>}
      <Button className="mt-4" variant="primary" onClick={reset}>Retry</Button>
    </div>
  );
}
