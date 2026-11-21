// Default field map for Zoho CRM. A tenant's saved integration_field_maps rows replace a row here for the same external field.
// conflict_owner defaults to "crm" (the database default): on a true conflict the CRM's value wins and is pushed back. A tenant that
// keeps Zoho as its system of record sets "external" on the rows it wants Zoho to win. Stage labels are Zoho's standard sales
// stages; a stage the tenant renamed has no mapping and the deal is rejected as stage_unmapped (never guessed).
import type { FieldMapSpec } from "../core/types";
import { MODULE } from "./constants";

export const ZOHO_STAGE_MAP: Record<string, string> = {
  "Qualification": "discovery", "Needs Analysis": "discovery", "Value Proposition": "demo_done", "Identify Decision Makers": "demo_done",
  "Proposal/Price Quote": "proposal", "Negotiation/Review": "negotiation", "Closed Won": "won", "Closed Lost": "lost", "Closed Lost to Competition": "lost",
};

const row = (externalObject: string, externalField: string, localTable: string, localColumn: string, extra: Partial<FieldMapSpec> = {}): FieldMapSpec =>
  ({ externalObject, externalField, localTable, localColumn, direction: "both", conflictOwner: "crm", ...extra });

const L = MODULE.lead, C = MODULE.contact, A = MODULE.account, D = MODULE.deal;
export const ZOHO_DEFAULT_MAP: FieldMapSpec[] = [
  row(L, "Full_Name", "leads", "full_name"), row(L, "Email", "leads", "email", { transform: "lower_email" }), row(L, "Phone", "leads", "phone", { transform: "e164_phone" }),
  row(L, "Company", "leads", "firm_name"), row(L, "Designation", "leads", "role_title"), row(L, "City", "leads", "city"),
  row(C, "Full_Name", "contacts", "full_name"), row(C, "Email", "contacts", "email", { transform: "lower_email" }), row(C, "Phone", "contacts", "phone", { transform: "e164_phone" }),
  row(C, "Title", "contacts", "role_title"), row(C, "Account_Name.id", "contacts", "account_id"),
  row(A, "Account_Name", "accounts", "name"), row(A, "Billing_City", "accounts", "city"), row(A, "Billing_State", "accounts", "state"),
  row(A, "Billing_Street", "accounts", "address_line"), row(A, "Website", "accounts", "website"),
  row(D, "Deal_Name", "deals", "name"), row(D, "Stage", "deals", "stage_id", { transform: "stage_key_map", transformArg: { map: ZOHO_STAGE_MAP } }),
  row(D, "Amount", "deals", "value_inr"), row(D, "Closing_Date", "deals", "expected_close_on", { transform: "date_ist" }),
  row(D, "Account_Name.id", "deals", "account_id"), row(D, "Contact_Name.id", "deals", "primary_contact_id"), row(D, "Next_Step", "deals", "next_step"),
];
