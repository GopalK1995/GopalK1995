import { PlatformAuditPanel } from "@/lib/audit/ui/platform-panel";
import type { OrgAuditSearch } from "@/lib/audit/ui/org-panel";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<OrgAuditSearch> }) {
  return <PlatformAuditPanel sp={await searchParams} />;
}
