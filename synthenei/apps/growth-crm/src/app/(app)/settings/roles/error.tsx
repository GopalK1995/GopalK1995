"use client";
import { ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import en from "../../../../../messages/en/settings-access.json";

// Route error boundary: names the failing source and offers retry (English draft; the page renders locale-aware text).
export default function AccessError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState source={en.loadErrorSource} message={en.loadErrorBody} retry={<Button onClick={reset}>{en.retry}</Button>} />;
}
