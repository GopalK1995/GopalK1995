// Metadata types (CONTRACTS C13). Pure and client-safe: no server imports here.
// Product names for field types (card): currency = "money" (INR), relation = "lookup".

export const FIELD_TYPES = [
  "text", "long_text", "number", "money", "percent", "date", "datetime", "boolean",
  "select", "multi_select", "user", "lookup", "phone", "email", "url", "rating",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Types an admin can create from the editor (rating and percent stay valid for API and imported definitions). */
export const EDITOR_TYPES: FieldType[] = ["text", "long_text", "number", "money", "date", "datetime", "select", "multi_select", "boolean", "url", "email", "phone", "user", "lookup"];

export const SYSTEM_OBJECT_KEYS = ["lead", "deal", "account", "contact", "task"] as const;
export type SystemObjectKey = (typeof SYSTEM_OBJECT_KEYS)[number];

export interface I18nLabel { en: string; ta?: string }
export type FieldColor = "neutral" | "accent" | "info" | "warn" | "success" | "danger";
export const FIELD_COLORS: FieldColor[] = ["neutral", "accent", "info", "warn", "success", "danger"];

export interface Choice { key: string; label: I18nLabel; color?: FieldColor; /** Retired option: kept so existing values stay valid, hidden from pickers. */ archived?: boolean }

export interface FieldAccess {
  /** Role keys that may see the value. Empty or absent = every role that can read the record. */
  viewRoles?: string[];
  /** Role keys that may change the value. Empty or absent = every role that can write the record. */
  editRoles?: string[];
}

export interface FieldOptions {
  choices?: Choice[];
  lookup?: { objectKey: string };
  currency?: "INR";
  min?: number;
  max?: number;
  precision?: number;
  access?: FieldAccess;
}

export interface FieldValidation { regex?: string; pattern?: string; maxLength?: number; min?: number; max?: number }

export interface FieldDef {
  id: string; objectTypeId: string; key: string; label: I18nLabel; type: FieldType; options: FieldOptions;
  required: boolean; uniqueInWorkspace: boolean; isPii: boolean; isSearchable: boolean; isFilterable: boolean;
  default: unknown; validation: FieldValidation; help?: I18nLabel; section: string | null;
  position: number; editablePerm: string | null; archivedAt: string | null;
  /** Concurrency token for the editor (field_defs has no version column yet: updated_at is used). */
  rev?: string;
}

export interface ObjectTypeDef {
  id: string; key: string; kind: "system" | "custom";
  label: { en: { one: string; many: string }; ta?: { one: string; many: string } };
  icon: string; primaryField: string; isEnabled: boolean; schemaVersion: number;
}

export interface Issue { path: string; message: string }
export type ValidateMode = "create" | "update";

/** Postgres table and column that hold the custom values of an object key. */
export function customStorage(objectKey: string): { table: string; column: "custom" | "data" } {
  const t: Record<string, string> = { lead: "leads", deal: "deals", account: "accounts", contact: "contacts", task: "tasks", campaign: "campaigns", conversation: "conversations" };
  return t[objectKey] ? { table: t[objectKey], column: "custom" } : { table: "records", column: "data" };
}

/** Authz object type of an object key ('obj:<key>' for custom objects). */
export const authzTypeOf = (objectKey: string): string => (["lead", "deal", "account", "contact", "task", "campaign", "conversation"].includes(objectKey) ? objectKey : `obj:${objectKey}`);

export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{1,40}$/;
