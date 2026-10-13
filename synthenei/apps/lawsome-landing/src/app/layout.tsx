import type { Metadata } from "next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "LAWSOME — Your Entire Law Firm. One Clear View.",
  description: "Legal practice management for Indian law firms: firm-wide dashboard, case and hearing control, eCourts search and Ask Nidhi, the AI legal assistant.",
  openGraph: { title: "LAWSOME — Your Entire Law Firm. One Clear View.", description: "Manage cases, hearings, calendars, teams and court information in one connected workspace.", type: "website" },
  robots: { index: false, follow: false }, // campaign page: remove when ready to be indexed
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
