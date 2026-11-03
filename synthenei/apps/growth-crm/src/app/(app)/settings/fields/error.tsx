"use client";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { ft } from "@/lib/metadata/strings";

export default function FieldsError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState source={ft("loadErrorSource")} message={ft("loadErrorBody")} retry={<Button onClick={reset}>{ft("retry")}</Button>} />;
}
