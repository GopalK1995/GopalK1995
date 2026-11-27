import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { cookies } from "next/headers";
import { WS_COOKIE } from "@/lib/auth/session";
import { tenantOf } from "@/lib/tenancy";
import { getLocale } from "@/i18n/server";
import { intlTag } from "@/i18n/config";
import { notoSansTamil } from "@/i18n/fonts";
import { HydrationMarker } from "@/components/shell/hydration-marker";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = tenantOf((await cookies()).get(WS_COOKIE)?.value ?? "");
  const product = t?.vertical === "hospitality" ? t.product : "Growth CRM";
  return { title: { default: product, template: `%s · ${product}` }, description: t?.vertical === "hospitality" ? `${product} for ${t.name} (sample data).` : "Sales and marketing CRM for LAWSOME (sample data)." };
}
export const viewport: Viewport = { themeColor: "#0e2236", width: "device-width", initialScale: 1 };

// Tamil only: Noto Sans Tamil, 13px floor, line-height +10%, and wrapping of long words so 390px never overflows.
const TAMIL_CSS = `html[lang="ta-IN"] body{font-family:var(--font-tamil),var(--font-geist-sans),system-ui,sans-serif;font-size:max(13px,1em);line-height:1.65;overflow-wrap:anywhere}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = tenantOf((await cookies()).get(WS_COOKIE)?.value ?? "");
  // No client i18n provider here: public pages (login, auth/*, legal, docs) have no client component that reads messages, so they ship none.
  // The signed-in app gets its provider in (app)/layout.tsx (namespaces in src/i18n/namespaces.ts).
  const locale = await getLocale();
  const ta = locale === "ta";
  return (
    <html lang={intlTag(locale)} data-tenant={tenant?.id ?? "lawsome"} className={`${GeistSans.variable} ${GeistMono.variable}${ta ? ` ${notoSansTamil.variable}` : ""}`} suppressHydrationWarning>
      <head>
        {ta && <style>{TAMIL_CSS}</style>}
      </head>
      <body>{children}<HydrationMarker /></body>
    </html>
  );
}
