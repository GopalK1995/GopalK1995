// Default field map for HubSpot (contacts, companies, deals). A tenant's saved integration_field_maps rows replace a row here for the
// same external field (one row per external field, so the contacts-as-contacts variant is derived, not listed). conflict_owner defaults to "crm" (the database default). Contacts land as leads by default; when the connection
// is set to land them as contacts, the "contacts" table rows below apply instead. Stage ids are HubSpot's default pipeline; a tenant
// with a custom pipeline maps its own stage ids (an unmapped stage rejects the deal as stage_unmapped, never guessed).
import type { FieldMapSpec } from "../core/types";

export const HUBSPOT_STAGE_MAP: Record<string, string> = {
  appointmentscheduled: "demo_scheduled", qualifiedtobuy: "discovery", presentationscheduled: "demo_scheduled", decisionmakerboughtin: "demo_done",
  contractsent: "proposal", closedwon: "won", closedlost: "lost",
};

const row = (externalObject: string, externalField: string, localTable: string, localColumn: string, extra: Partial<FieldMapSpec> = {}): FieldMapSpec =>
  ({ externalObject, externalField, localTable, localColumn, direction: "both", conflictOwner: "crm", ...extra });

export const HUBSPOT_DEFAULT_MAP: FieldMapSpec[] = [
  row("contacts", "full_name", "leads", "full_name"), row("contacts", "email", "leads", "email", { transform: "lower_email" }), row("contacts", "phone", "leads", "phone", { transform: "e164_phone" }),
  row("contacts", "company", "leads", "firm_name"), row("contacts", "jobtitle", "leads", "role_title"), row("contacts", "city", "leads", "city"),
  row("companies", "name", "accounts", "name"), row("companies", "city", "accounts", "city"), row("companies", "state", "accounts", "state"),
  row("companies", "address", "accounts", "address_line"), row("companies", "website", "accounts", "website"),
  row("deals", "dealname", "deals", "name"), row("deals", "dealstage", "deals", "stage_id", { transform: "stage_key_map", transformArg: { map: HUBSPOT_STAGE_MAP } }),
  row("deals", "amount", "deals", "value_inr"), row("deals", "closedate", "deals", "expected_close_on", { transform: "date_ist" }),
];

/** The map for a connection: contacts land as leads (default) or, when the connection says so, as contacts. */
export const hubspotDefaultMap = (contactTarget: "lead" | "contact"): FieldMapSpec[] =>
  contactTarget === "contact" ? HUBSPOT_DEFAULT_MAP.map((f) => (f.externalObject === "contacts" ? { ...f, localTable: "contacts" } : f)) : HUBSPOT_DEFAULT_MAP;
