"use client";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import en from "../../../../messages/en/collab.json";

// Route error boundary: names the failing source and offers retry (English draft; the page renders locale-aware text).
export default function NotificationsError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState source={en.notifErrorSource} message={en.notifErrorBody} retry={<Button variant="secondary" onClick={reset}>{en.retry}</Button>} />;
}
