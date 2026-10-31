import { OrgAuditPanel, type OrgAuditSearch } from "@/lib/audit/ui/org-panel";

export const metadata = { title: "Audit log" };

export default async function SettingsAuditPage({ searchParams }: { searchParams: Promise<OrgAuditSearch> }) {
  return <OrgAuditPanel sp={await searchParams} basePath="/settings/audit" />;
}
