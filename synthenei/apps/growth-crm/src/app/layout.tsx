import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { brandBootScript } from "@/components/shell/providers";
import { cookies } from "next/headers";
import { WS_COOKIE } from "@/lib/auth/session";
import { tenantOf } from "@/lib/tenancy";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Growth CRM", template: "%s · Growth CRM" }, description: "Sales and marketing CRM for LAWSOME (sample data)." };
export const viewport: Viewport = { themeColor: "#0e2236", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = tenantOf((await cookies()).get(WS_COOKIE)?.value ?? "");
  return (
    <html lang="en-IN" data-tenant={tenant?.id ?? "lawsome"} className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: brandBootScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
