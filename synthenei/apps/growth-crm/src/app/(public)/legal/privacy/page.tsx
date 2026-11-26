import type { Metadata } from "next";
import { LegalPage, legalMetadata } from "@/components/legal/legal-page";
import { readLegalConfig } from "@/lib/legal/config";
import { privacyDoc, LEGAL_PATHS } from "@/lib/legal/content";

// Public, unauthenticated platform legal page. Read from the environment on every request (never baked in at build time).
export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata { const c = readLegalConfig(); return legalMetadata(privacyDoc(c), c, LEGAL_PATHS.privacy); }
export default function Page() { const c = readLegalConfig(); return <LegalPage doc={privacyDoc(c)} cfg={c} />; }
