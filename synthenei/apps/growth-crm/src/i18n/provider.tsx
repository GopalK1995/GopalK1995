"use client";
import { NextIntlClientProvider } from "next-intl";
import type { Locale } from "./config";
import type { Messages } from "./registry";

/** Client t(): next-intl's useTranslations("shell") works under this provider. */
export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: React.ReactNode }) {
  return <NextIntlClientProvider locale={locale} messages={messages as never} timeZone="Asia/Kolkata">{children}</NextIntlClientProvider>;
}
