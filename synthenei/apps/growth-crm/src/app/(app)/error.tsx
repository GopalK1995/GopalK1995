"use client";
import { RouteError } from "@/components/ui/route-error";

/** Page-level error state for the signed-in app: heading, human message, Retry and an error id. Never falls back to sample data and never prints raw error text. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} />;
}
