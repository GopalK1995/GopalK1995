// Server-only entry for the `privacy` namespace: resolves the visitor's locale cookie via src/i18n/server.ts
// (next/headers). Kept out of strings.ts so no client component importing the pure helpers there drags this in.
import "server-only";
import { makePrT, type Loc, type PrT } from "./strings";

export async function getPrT(): Promise<{ t: PrT; locale: Loc }> {
  const { getLocale } = await import("@/i18n/server");
  const locale: Loc = (await getLocale()) === "ta" ? "ta" : "en";
  return { t: makePrT(locale), locale };
}
