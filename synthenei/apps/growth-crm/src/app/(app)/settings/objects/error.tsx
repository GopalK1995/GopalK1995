"use client";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { ot } from "@/lib/layouts/strings";

export default function ObjectsError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState source={ot("objectsLoadErrorSource")} message={ot("loadErrorBody")} retry={<Button onClick={reset}>{ot("retry")}</Button>} />;
}
