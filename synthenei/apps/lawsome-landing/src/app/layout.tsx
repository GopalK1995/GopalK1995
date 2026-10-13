import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Source_Serif_4 } from "next/font/google";
import "@/styles/globals.css";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--ff-sans", display: "swap" });
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--ff-serif", display: "swap", weight: ["500", "600"] });

export const metadata: Metadata = {
  title: "LAWSOME — Your Entire Law Firm. One Clear View.",
  description: "Legal practice management for Indian law firms: firm-wide dashboard, case and hearing control, eCourts search and Ask Nidhi, the AI legal assistant.",
  openGraph: { title: "LAWSOME — Your Entire Law Firm. One Clear View.", description: "Manage cases, hearings, calendars, teams and court information in one connected workspace.", type: "website" },
  robots: { index: false, follow: false }, // campaign page: remove when ready to be indexed
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en" className={`${sans.variable} ${serif.variable}`}><body>{children}</body></html>);
}
