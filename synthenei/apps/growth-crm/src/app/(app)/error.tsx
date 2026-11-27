"use client";
import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { humanMessage } from "@/lib/error-message";

/** Page-level error state: human message, Retry, never falls back to sample data and never prints the raw framework text. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // The browser only gets Next's generic message in production; log what we do have so the id maps to a class (server side: instrumentation.ts).
  useEffect(() => { console.error("[page-error]", { digest: error.digest ?? null, name: error.name, message: String(error.message ?? "").slice(0, 200) }); }, [error]);
  return (
    <div role="alert" className="mx-auto mt-12 max-w-lg rounded-md border border-danger/25 bg-surface p-5 shadow-1">
      <div className="flex items-center gap-2 text-[14px] font-semibold text-danger"><TriangleAlert className="size-4" aria-hidden />This page could not load its data</div>
      <p className="mt-2 text-[13px] text-ink-2">{humanMessage(error)}</p>
      {error.digest && <p className="mt-1 font-mono text-[11px] text-ink-3">Error id {error.digest}</p>}
      <Button className="mt-4" variant="primary" onClick={reset}>Retry</Button>
    </div>
  );
}
