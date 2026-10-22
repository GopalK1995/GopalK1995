// CSV import templates and column documentation, worded from the tenant's own taxonomy. Pure: used by the
// "Data & import" editor (client download) and by the import dialog's column-mapping step.
import { stageList, type ImportKind, type TenantConfig } from "./types";

export interface CsvColumn { name: string; required: boolean; description: string; example: string }
const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const list = (xs: string[]) => xs.join(" | ");

export function csvColumns(kind: ImportKind, cfg: TenantConfig): CsvColumn[] {
  const n = cfg.vocabulary.n, tx = cfg.taxonomies;
  const interest = tx.interests.length ? list(tx.interests) : "any text";
  if (kind === "leads") {
    const stages = stageList(cfg.stages.lead).map((s) => cfg.stages.lead[s].label);
    return [
      { name: "name", required: true, description: `Full name of the ${n.lead.one} contact`, example: "Asha Menon" },
      { name: "phone", required: false, description: "Mobile number with country code", example: "+919876500000" },
      { name: "email", required: false, description: "Work or personal email", example: "asha@example.com" },
      { name: n.firm.one, required: false, description: `${n.firm.one[0].toUpperCase()}${n.firm.one.slice(1)} name`, example: "Menon family" },
      { name: "source_channel", required: false, description: `One of: ${list(Object.values(tx.channelFamily))}`, example: Object.values(tx.channelFamily)[0] ?? "" },
      { name: "category", required: false, description: `One of: ${interest}`, example: tx.interests[0] ?? "" },
      { name: "size", required: false, description: `One of: ${list(Object.values(tx.partySize))}`, example: Object.values(tx.partySize)[1] ?? "" },
      { name: "stage", required: false, description: `One of: ${list(stages)}`, example: stages[0] ?? "" },
      { name: "created_at", required: false, description: "Date as YYYY-MM-DD", example: "2026-10-01" },
      { name: "marketing_consent", required: false, description: "yes or no. Leave blank for no.", example: "yes" },
    ];
  }
  if (kind === "accounts") {
    return [
      { name: "name", required: true, description: `${n.firm.one[0].toUpperCase()}${n.firm.one.slice(1)} name`, example: "Menon family" },
      { name: "city", required: false, description: "City or town", example: "Coimbatore" },
      { name: "size", required: false, description: `One of: ${list(Object.values(tx.partySize))}`, example: Object.values(tx.partySize)[1] ?? "" },
      { name: "category", required: false, description: `One of: ${interest}`, example: tx.interests[0] ?? "" },
      { name: "phone", required: false, description: "Main phone number", example: "+919876500000" },
      { name: "email", required: false, description: "Main email", example: "office@example.com" },
    ];
  }
  return [
    { name: "campaign_name", required: true, description: "Name as shown in the ad platform", example: "Monsoon weekends" },
    { name: "channel", required: true, description: "Platform: linkedin, meta, google_ads, whatsapp or email", example: "meta" },
    { name: "date", required: true, description: "Day as YYYY-MM-DD", example: "2026-10-01" },
    { name: "spend", required: false, description: "Amount spent in rupees", example: "1200" },
    { name: "impressions", required: false, description: "Impressions or reach", example: "15000" },
    { name: "clicks", required: false, description: "Link clicks", example: "240" },
    { name: "platform_leads", required: false, description: `${n.lead.many[0].toUpperCase()}${n.lead.many.slice(1)} the platform reports`, example: "18" },
  ];
}
export const csvTemplate = (kind: ImportKind, cfg: TenantConfig) => {
  const cols = csvColumns(kind, cfg);
  return `${cols.map((c) => q(c.name)).join(",")}\n${cols.map((c) => q(c.example)).join(",")}\n`;
};
export const CSV_FILE: Record<ImportKind, string> = { leads: "enquiries-leads-template.csv", accounts: "accounts-template.csv", campaigns: "campaigns-template.csv" };
