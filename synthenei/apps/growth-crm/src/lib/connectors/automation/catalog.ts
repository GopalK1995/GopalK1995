// The trigger / action catalogue shared by the Zapier private app (integrations/zapier-app) and the Make custom app (integrations/make-app).
// Both apps are plain files outside the Next bundle (they are uploaded with the vendors' own CLI / editor), so they cannot import this
// module; they restate the same list and __tests__/apps.test.ts fails when either drifts from it, from the event catalogue (webhook-
// eligible only) or from the REST API schemas (every action field must exist in the zod schema it sends to).
// Everything here is generic: no tenant, brand or URL. The API base URL is an auth field the user types in the vendor's UI.

export interface TriggerDef { key: string; label: string; description: string; events: readonly string[]; objectPath: "leads" | "deals" | "payments" | null }
export const TRIGGERS: readonly TriggerDef[] = [
  { key: "new_lead", label: "New Lead", description: "Triggers when a lead is created.", events: ["lead.created"], objectPath: "leads" },
  { key: "lead_stage_changed", label: "Lead Status Changed", description: "Triggers when a lead moves to another status.", events: ["lead.stage_changed"], objectPath: "leads" },
  { key: "new_deal", label: "New Deal", description: "Triggers when a deal is created.", events: ["deal.created"], objectPath: "deals" },
  { key: "deal_stage_changed", label: "Deal Stage Changed", description: "Triggers when a deal moves to another stage.", events: ["deal.stage_changed"], objectPath: "deals" },
  { key: "deal_won", label: "Deal Won", description: "Triggers when a deal is marked won.", events: ["deal.won"], objectPath: "deals" },
  { key: "payment_received", label: "Payment Received", description: "Triggers when a payment is received.", events: ["payment.paid"], objectPath: null },
] as const;

export interface FieldDef { key: string; label: string; type: "string" | "number" | "datetime" | "date" | "integer" | "boolean"; required?: boolean; help?: string }
export interface ActionDef { key: string; label: string; description: string; method: "POST" | "PATCH"; path: string; /** zod schema name in src/lib/api/schemas.ts */ schema: "leadCreate" | "dealUpdate" | "dealMove"; fields: readonly FieldDef[] }

export const ACTIONS: readonly ActionDef[] = [
  {
    key: "create_lead", label: "Create Lead", description: "Creates a lead in the CRM.", method: "POST", path: "/api/v1/leads", schema: "leadCreate",
    fields: [
      { key: "full_name", label: "Full name", type: "string", required: true },
      { key: "email", label: "Email", type: "string" }, { key: "phone", label: "Phone", type: "string", help: "With country code, e.g. +91..." },
      { key: "city", label: "City", type: "string" }, { key: "district", label: "District", type: "string" },
      { key: "source", label: "Source", type: "string", help: "Where the lead came from, e.g. the name of the form or ad." },
      { key: "firm_name", label: "Firm name", type: "string" }, { key: "practice_area", label: "Practice area", type: "string" }, { key: "role_title", label: "Role title", type: "string" },
    ],
  },
  {
    key: "update_deal", label: "Update Deal", description: "Changes fields of an existing deal. To change its stage use Move Deal.", method: "PATCH", path: "/api/v1/deals/{id}", schema: "dealUpdate",
    fields: [
      { key: "id", label: "Deal ID", type: "string", required: true },
      { key: "name", label: "Name", type: "string" }, { key: "value_inr", label: "Value (INR)", type: "number" },
      { key: "next_step", label: "Next step", type: "string" }, { key: "next_step_at", label: "Next step at", type: "datetime" },
      { key: "expected_close_on", label: "Expected close date", type: "date" }, { key: "plan", label: "Plan", type: "string" }, { key: "seats", label: "Seats", type: "integer" },
    ],
  },
  {
    key: "move_deal", label: "Move Deal to Stage", description: "Moves a deal to a pipeline stage (by stage key).", method: "POST", path: "/api/v1/deals/{id}/move", schema: "dealMove",
    fields: [
      { key: "id", label: "Deal ID", type: "string", required: true },
      { key: "stage_key", label: "Stage key", type: "string", required: true },
      { key: "lost_reason", label: "Lost reason", type: "string", help: "Only when moving to a lost stage." },
    ],
  },
] as const;

/** Path parameters are not body fields. */
export const bodyFields = (a: ActionDef): FieldDef[] => a.fields.filter((f) => f.key !== "id");
