// Allow-listed segment fields. A segment rule can only name a key from this list (plus `is_filterable` custom fields passed in
// by the caller), so a field name never reaches a query unchecked. Values are always bound, never concatenated.
export type FieldKind = "text" | "enum" | "bool";
export interface SegmentField { key: string; column: string; kind: FieldKind; custom?: boolean }

export const SYSTEM_FIELDS: readonly SegmentField[] = [
  { key: "district", column: "district", kind: "text" },
  { key: "city", column: "city", kind: "text" },
  { key: "practice", column: "practice_area", kind: "text" },
  { key: "title", column: "role_title", kind: "text" },
  { key: "firm", column: "firm_name", kind: "text" },
  { key: "status", column: "status", kind: "enum" },
  { key: "source", column: "source", kind: "enum" },
  { key: "channel", column: "first_touch_channel", kind: "enum" },
  { key: "campaign", column: "campaign_id", kind: "enum" },
  { key: "owner", column: "owner_id", kind: "enum" },
  { key: "personalEmail", column: "personal_email", kind: "bool" },
] as const;

/** Custom-field keys follow field_defs.key: ^[a-z][a-z0-9_]{1,40}$. Only keys the caller marked is_filterable are accepted. */
export const CUSTOM_KEY_RE = /^[a-z][a-z0-9_]{1,40}$/;
export interface CustomFieldRef { key: string }

export const LIMITS = { rules: 10, values: 50, valueLen: 120, nameLen: 80 } as const;
