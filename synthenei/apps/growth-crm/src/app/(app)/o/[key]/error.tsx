"use client";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { ot } from "@/lib/layouts/strings";

export default function ObjectError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState source={ot("recordsErrorSource", { nouns: "" })} message={ot("recordsErrorBody")} retry={<Button onClick={reset}>{ot("retry")}</Button>} />;
}
