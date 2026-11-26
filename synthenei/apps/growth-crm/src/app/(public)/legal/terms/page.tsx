import type { Metadata } from "next";
import { LegalPage, legalMetadata } from "@/components/legal/legal-page";
import { readLegalConfig } from "@/lib/legal/config";
import { termsDoc, LEGAL_PATHS } from "@/lib/legal/content";

// Public, unauthenticated platform legal page. Read from the environment on every request (never baked in at build time).
export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata { const c = readLegalConfig(); return legalMetadata(termsDoc(c), c, LEGAL_PATHS.terms); }
export default function Page() { const c = readLegalConfig(); return <LegalPage doc={termsDoc(c)} cfg={c} />; }
