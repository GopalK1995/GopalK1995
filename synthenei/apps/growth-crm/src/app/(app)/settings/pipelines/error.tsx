"use client";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

export default function PipelinesError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState source="Pipelines" message="The stages could not be loaded. Nothing was changed." retry={<Button onClick={reset}>Retry</Button>} />;
}
