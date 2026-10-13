import type { Metadata } from "next";
import "@/styles/globals.css";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "LAWSOME Growth CRM",
  description: "Internal funnel, campaign and lead platform for the LAWSOME product. Demo build with synthetic data.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body>
      <div className="shell">
        <Sidebar />
        <main className="main">
          <div className="banner" role="note"><strong>Demo build.</strong> All people, firms and numbers are synthetic. LinkedIn, GA4 and backup data are mocked; no external service is connected.</div>
          {children}
        </main>
      </div>
    </body></html>
  );
}
