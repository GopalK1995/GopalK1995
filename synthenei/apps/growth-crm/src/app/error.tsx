"use client";
import { RouteError } from "@/components/ui/route-error";

/** Boundary for public routes (login, auth, legal, shared pages) that have no closer one. Rendered inside the root layout, so no app shell or i18n provider is assumed. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} homeHref="/" bare />;
}
