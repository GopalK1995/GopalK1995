"use client";
import { ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import en from "../../../../messages/en/tasks.json";

// Route error boundary: names the failing source and offers retry (English draft; the page renders locale-aware text).
export default function TasksError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState source={en.errorSource} message={en.errorMessage} retry={<Button variant="secondary" onClick={reset}>{en.retry}</Button>} />;
}
