"use client";
import { ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";

// Route error boundary: names the failing source and offers retry.
export default function AudienceError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState source="Audience" message="Audience data could not be loaded. Nothing was changed." retry={<Button variant="secondary" onClick={reset}>Try again</Button>} />;
}
