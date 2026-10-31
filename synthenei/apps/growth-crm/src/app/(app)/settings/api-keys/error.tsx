"use client";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { ak } from "./_lib/strings";

export default function ApiKeysError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState source={ak("loadErrorSource")} message={ak("loadErrorBody")} retry={<Button onClick={reset}>{ak("retry")}</Button>} />;
}
