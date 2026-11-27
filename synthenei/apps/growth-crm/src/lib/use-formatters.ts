"use client";
// Client hook: the shared formatters keyed from the active next-intl locale. Falls back to English when there is no provider
// (isolated component tests, error boundaries rendered outside the shell).
import { useLocale } from "next-intl";
import { fmtFor, type FormatLocale, type Formatters } from "@/lib/format";

export function useFormatLocale(): FormatLocale {
  let l = "en";
  // The call order is identical on every render (the try only catches the missing-provider throw), so the rule is a false positive here.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  try { l = useLocale(); } catch { /* no NextIntlClientProvider above: English */ }
  return l === "ta" ? "ta" : "en";
}
export function useFormatters(): Formatters { return fmtFor(useFormatLocale()); }
