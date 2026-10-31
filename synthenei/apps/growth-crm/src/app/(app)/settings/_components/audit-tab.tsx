// Settings > Audit tab. Drop-in for the demo-only Audit() in settings/page.tsx:
//   {tab === "audit" && <AuditTab sp={sp} />}
// The same viewer is also served at /settings/audit (src/app/(app)/settings/audit/page.tsx).
import { OrgAuditPanel, type OrgAuditSearch } from "@/lib/audit/ui/org-panel";

export function AuditTab({ sp }: { sp: OrgAuditSearch }) {
  return <OrgAuditPanel sp={sp} basePath="/settings" fixed={{ tab: "audit" }} withHeader={false} />;
}
