"use client";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import en from "../../../../../messages/en/collab.json";

export default function NotificationSettingsError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState source={en.prefsTitle} message={en.notifErrorBody} retry={<Button variant="secondary" onClick={reset}>{en.retry}</Button>} />;
}
