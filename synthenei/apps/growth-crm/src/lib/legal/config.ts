// Platform legal identity, read from the environment only. Nothing company-specific is hardcoded: when a value is missing the pages
// say so (DRAFT banner, noindex) instead of showing placeholders as final legal text. Names are listed in .env.example (no values).
export const LEGAL_ENV = {
  legalName: "PLATFORM_LEGAL_NAME",
  address: "PLATFORM_REGISTERED_ADDRESS",
  contactEmail: "PLATFORM_CONTACT_EMAIL",
  grievanceName: "PLATFORM_GRIEVANCE_OFFICER_NAME",
  grievanceEmail: "PLATFORM_GRIEVANCE_OFFICER_EMAIL",
  city: "PLATFORM_JURISDICTION_CITY",
  effectiveDate: "PLATFORM_LEGAL_EFFECTIVE_DATE",
  region: "PLATFORM_DATA_REGION",
} as const;
export type LegalKey = keyof typeof LEGAL_ENV;
export const REQUIRED_KEYS = Object.keys(LEGAL_ENV) as LegalKey[];

/** Optional extras. Unset = neutral wording ("without undue delay"), never an invented number. */
export const LEGAL_OPTIONAL_ENV = {
  productName: "PLATFORM_PRODUCT_NAME",
  deletionDays: "PLATFORM_DELETION_RESPONSE_DAYS",
  grievanceDays: "PLATFORM_GRIEVANCE_RESPONSE_DAYS",
  liabilityMonths: "PLATFORM_LIABILITY_CAP_MONTHS",
} as const;

export interface LegalConfig {
  values: Record<LegalKey, string | null>;
  /** Names of required variables that are unset or blank. */
  missing: string[];
  /** true only when every required value is present: the page may then be indexed and shown without a draft banner. */
  published: boolean;
  productName: string;
  deletionDays: number | null;
  grievanceDays: number | null;
  liabilityMonths: number | null;
}

const clean = (v: string | undefined): string | null => { const t = (v ?? "").trim(); return t === "" ? null : t; };
const days = (v: string | undefined): number | null => { const t = clean(v); return t && /^\d{1,3}$/.test(t) && Number(t) > 0 ? Number(t) : null; };

export function readLegalConfig(env: Record<string, string | undefined> = process.env): LegalConfig {
  const values = {} as Record<LegalKey, string | null>;
  const missing: string[] = [];
  for (const k of REQUIRED_KEYS) { values[k] = clean(env[LEGAL_ENV[k]]); if (!values[k]) missing.push(LEGAL_ENV[k]); }
  return {
    values, missing, published: missing.length === 0,
    productName: clean(env[LEGAL_OPTIONAL_ENV.productName]) ?? "Growth CRM",
    deletionDays: days(env[LEGAL_OPTIONAL_ENV.deletionDays]),
    grievanceDays: days(env[LEGAL_OPTIONAL_ENV.grievanceDays]),
    liabilityMonths: days(env[LEGAL_OPTIONAL_ENV.liabilityMonths]),
  };
}
