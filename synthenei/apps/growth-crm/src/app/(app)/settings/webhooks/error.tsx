"use client";
import { RouteError } from "@/components/ui/route-error";

/** Route boundary: names the area that failed, with the shared heading, Retry and error id (copy lives in the errors message files). */
export default function RouteBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} source="Webhooks" />;
}
