"use client";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { wh } from "./_lib/strings";

export default function WebhooksError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState source={wh("loadErrorSource")} message={wh("loadErrorBody")} retry={<Button onClick={reset}>{wh("retry")}</Button>} />;
}
