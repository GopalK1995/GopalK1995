// Shared import types. Pure.
export type ImportObject = "lead" | "contact" | "account";
export const IMPORT_OBJECTS: readonly ImportObject[] = ["lead", "contact", "account"] as const;
export const isImportObject = (s: string): s is ImportObject => (IMPORT_OBJECTS as readonly string[]).includes(s);

/** Duplicate handling: skip keeps the existing record, merge writes the mapped non-empty values over it. */
export type DupMode = "skip" | "merge";
/** import_jobs.mode values (migration 0019). */
export type JobMode = "create" | "update" | "upsert" | "skip_duplicates";
export const jobModeOf = (m: DupMode): JobMode => (m === "merge" ? "upsert" : "skip_duplicates");
export const dupModeOf = (m: string): DupMode => (m === "upsert" || m === "update" ? "merge" : "skip");

export type FieldKind = "text" | "email" | "phone" | "number" | "boolean" | "date" | "select" | "url";
export interface TargetField {
  /** System column name, or `custom.<key>` for a custom field_def. */
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** Extra header names (lower case) that auto-map here. */
  aliases?: string[];
  choices?: string[];
  isPii?: boolean;
}

/** CSV header (exactly as in the file) -> target field key. Empty string = ignore the column. */
export type Mapping = Record<string, string>;

export interface ParsedRow { rowNo: number; cells: Record<string, string> }
export interface ParsedSheet { headers: string[]; rows: ParsedRow[]; blankRows: number }

export type RowReason =
  | "name_required" | "contact_required" | "email_invalid" | "phone_invalid" | "number_invalid" | "date_invalid"
  | "boolean_invalid" | "choice_invalid" | "url_invalid" | "required_missing" | "too_long" | "duplicate_in_file" | "write_failed";

export interface RowIssue { field: string; reason: RowReason; value?: string }
export type RowStatus = "new" | "duplicate" | "invalid";

export interface PlannedRow {
  rowNo: number;
  status: RowStatus;
  /** Cleaned values: system columns plus `custom` for field_defs keys. */
  record: Record<string, unknown>;
  custom: Record<string, unknown>;
  issues: RowIssue[];
  /** Existing record to merge into (null for in-file duplicates). */
  dupId: string | null;
  dupKey: "email" | "phone" | "name_city" | null;
}

export interface ExistingIndex {
  byEmail: Map<string, string>;
  byPhone: Map<string, string>;
  byNameCity: Map<string, string>;
}
export const emptyIndex = (): ExistingIndex => ({ byEmail: new Map(), byPhone: new Map(), byNameCity: new Map() });

export interface PlanSummary { total: number; fresh: number; duplicates: number; invalid: number }
