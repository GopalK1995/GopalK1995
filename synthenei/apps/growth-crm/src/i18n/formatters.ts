// Server-side counterpart of useFormatters(): `const f = await getFormatters(); f.inr(n)`.
import "server-only";
import { fmtFor, type Formatters } from "@/lib/format";
import { getLocale } from "./server";

export async function getFormatters(override?: string | null): Promise<Formatters> {
  return fmtFor((await getLocale(override)) === "ta" ? "ta" : "en");
}
