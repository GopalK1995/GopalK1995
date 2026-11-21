// Tenant-branded privacy notice. The wording is generic ({org} placeholders in messages/en/privacy.json); every tenant-specific fact
// (name, contact, response window, region, purposes, retention, grievance officer) comes from the tenant row or tenant_config.config.privacy.
// Nothing here names a tenant. Pure.
import type { PrT } from "./strings";
import type { PublicWorkspace } from "./types";

export interface NoticeSection { id: string; heading: string; body: string[] }

/** Region code to a readable place. Unknown codes are shown as given. */
const REGION: Record<string, string> = {
  "ap-southeast-1": "Singapore", "ap-south-1": "Mumbai, India", "ap-south-2": "Hyderabad, India", "eu-west-1": "Ireland", "eu-central-1": "Frankfurt, Germany",
  "us-east-1": "North Virginia, USA", "us-west-1": "California, USA",
};
export const regionLabel = (code: string): string => REGION[code] ?? code;

export function noticeVersion(w: PublicWorkspace): string { return w.notice.noticeVersion?.trim() || "v1"; }

export function buildNotice(w: PublicWorkspace, t: PrT): { title: string; version: string; effective: string | null; sections: NoticeSection[] } {
  const n = w.notice, org = w.orgName;
  const contactEmail = n.grievance?.email ?? w.dpo?.email ?? w.supportEmail;
  const officer = n.grievance?.name ?? w.dpo?.name ?? null;
  const sections: NoticeSection[] = [
    { id: "who", heading: t("notice.who.h"), body: [n.intro?.trim() || t("notice.who.b", { org })] },
    { id: "collect", heading: t("notice.collect.h"), body: [n.collects?.trim() || t("notice.collect.b", { org })] },
    {
      id: "why", heading: t("notice.why.h"),
      body: n.purposes?.length ? n.purposes.map((p) => `${p.label}: ${p.text}`) : [t("notice.why.b", { org })],
    },
    { id: "share", heading: t("notice.share.h"), body: [n.sharing?.trim() || t("notice.share.b", { org })] },
    { id: "where", heading: t("notice.where.h"), body: [n.transfers?.trim() || t("notice.where.b", { region: regionLabel(w.dataRegion) })] },
    { id: "keep", heading: t("notice.keep.h"), body: [n.retention?.trim() || t("notice.keep.b")] },
    { id: "rights", heading: t("notice.rights.h"), body: [t("notice.rights.b", { org, days: w.responseDays })] },
    {
      id: "grievance", heading: t("notice.grievance.h"),
      body: [contactEmail ? t("notice.grievance.b", { org, who: officer ?? t("notice.grievance.team"), email: contactEmail, hours: n.grievance?.hours ?? "7 days" }) : t("notice.grievance.none", { org })],
    },
    ...(n.extraSections ?? []).filter((s) => s.heading && s.body).map((s, i) => ({ id: `extra${i}`, heading: s.heading, body: [s.body] })),
  ];
  return { title: t("notice.title", { org }), version: noticeVersion(w), effective: n.effectiveDate ?? null, sections };
}
