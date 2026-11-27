"use client";
import { RouteError } from "@/components/ui/route-error";

/** Platform admin boundary (no app shell here): same human copy, with a way back to the console. */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} homeHref="/admin" bare />;
}
