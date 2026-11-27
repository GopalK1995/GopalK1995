import { OrgAuditPanel, type OrgAuditSearch } from "@/lib/audit/ui/org-panel";
import { pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("auditLog");

export default async function SettingsAuditPage({ searchParams }: { searchParams: Promise<OrgAuditSearch> }) {
  return <OrgAuditPanel sp={await searchParams} basePath="/settings/audit" />;
}
