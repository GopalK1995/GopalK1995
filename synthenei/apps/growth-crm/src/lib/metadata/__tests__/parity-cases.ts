// Validator parity cases: (type, validation/options, value) -> the exact error suffix metadata.check_value() returns in
// migration 0017, or null. The TS validator is tested against this table; a pgTAP file can iterate the same rows
// (see docs/tasks/T030.md, "Needs from integrator") so the two implementations cannot drift.
import type { FieldDef, FieldType } from "../types";

export interface ParityCase { name: string; type: FieldType; options?: FieldDef["options"]; validation?: FieldDef["validation"]; value: unknown; error: string | null }

const CH = { choices: [{ key: "hot", label: { en: "Hot" } }, { key: "cold", label: { en: "Cold" }, archived: true }] };

export const PARITY: ParityCase[] = [
  { name: "text ok", type: "text", value: "hello", error: null },
  { name: "text not a string", type: "text", value: 5, error: "must be text" },
  { name: "text too long (default 2000)", type: "text", value: "x".repeat(2001), error: "is too long" },
  { name: "text maxLength", type: "text", validation: { maxLength: 3 }, value: "abcd", error: "is too long" },
  { name: "long_text allows 20000", type: "long_text", value: "x".repeat(20000), error: null },
  { name: "text pattern ok", type: "text", validation: { pattern: "^[A-Z]{3}$" }, value: "ABC", error: null },
  { name: "text pattern fails", type: "text", validation: { pattern: "^[A-Z]{3}$" }, value: "abc", error: "does not match the required pattern" },
  { name: "email ok", type: "email", value: "a@b.in", error: null },
  { name: "email bad", type: "email", value: "a@b", error: "must be an email address" },
  { name: "phone ok", type: "phone", value: "+919876543210", error: null },
  { name: "phone with spaces ok", type: "phone", value: "+91 98765 43210", error: null },
  { name: "phone bad", type: "phone", value: "call me", error: "must be a phone number" },
  { name: "url ok", type: "url", value: "https://example.com/a", error: null },
  { name: "url needs http(s)", type: "url", value: "ftp://example.com", error: "must be an http(s) URL" },
  { name: "number ok", type: "number", value: 12.5, error: null },
  { name: "number as string", type: "number", value: "12", error: "must be a number" },
  { name: "number below min", type: "number", validation: { min: 10 }, value: 9, error: "is below the minimum" },
  { name: "number above max", type: "number", validation: { max: 10 }, value: 11, error: "is above the maximum" },
  { name: "percent bounds", type: "percent", value: 101, error: "must be between 0 and 100" },
  { name: "money ok", type: "money", value: 150000.5, error: null },
  { name: "money negative", type: "money", value: -1, error: "must not be negative" },
  { name: "date ok", type: "date", value: "2026-11-02", error: null },
  { name: "date wrong shape", type: "date", value: "02/11/2026", error: "must be a date (YYYY-MM-DD)" },
  { name: "date not on the calendar", type: "date", value: "2026-02-30", error: "is not valid" },
  { name: "datetime ok", type: "datetime", value: "2026-11-02T09:00:00.000Z", error: null },
  { name: "datetime not a string", type: "datetime", value: 5, error: "must be a date and time" },
  { name: "boolean ok", type: "boolean", value: false, error: null },
  { name: "boolean bad", type: "boolean", value: "true", error: "must be true or false" },
  { name: "select ok", type: "select", options: CH, value: "hot", error: null },
  { name: "select retired choice still valid", type: "select", options: CH, value: "cold", error: null },
  { name: "select unknown", type: "select", options: CH, value: "warm", error: "is not one of the listed choices" },
  { name: "multi_select ok", type: "multi_select", options: CH, value: ["hot", "cold"], error: null },
  { name: "multi_select bad member", type: "multi_select", options: CH, value: ["hot", "x"], error: "contains a value that is not a listed choice" },
  { name: "multi_select not a list", type: "multi_select", options: CH, value: "hot", error: "must be a list of choices" },
  { name: "user ok", type: "user", value: "123e4567-e89b-12d3-a456-426614174000", error: null },
  { name: "lookup bad id", type: "lookup", value: "abc", error: "must be a record id" },
  { name: "rating ok", type: "rating", value: 4, error: null },
  { name: "rating fraction", type: "rating", value: 4.5, error: "must be a whole number" },
  { name: "rating range", type: "rating", value: 6, error: "is outside the rating range" },
  { name: "null is always fine", type: "number", value: null, error: null },
];
