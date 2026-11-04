// Custom-object definition input (pure). The key is derived from the English singular label and is immutable once created
// (permissions, records, links and URLs refer to it). Reserved keys are the system objects and platform words.
import { z } from "zod";
import { ICON_KEYS } from "@/lib/layouts/icons";
import { keyFromLabel } from "@/lib/metadata/defs";
import { FIELD_KEY_RE } from "@/lib/metadata/types";

export const RESERVED_KEYS = [
  "lead", "contact", "account", "deal", "task", "campaign", "conversation", "message", "activity", "segment", "integration", "user", "users",
  "member", "role", "pipeline", "stage", "record", "records", "object", "objects", "field", "fields", "layout", "layouts", "view", "views", "new", "system", "settings", "admin", "api",
] as const;

const label = z.object({ en: z.string().trim().min(1, "Enter a name").max(60), ta: z.string().trim().max(60).optional().or(z.literal("")) });

export const objectInputSchema = z.object({
  one: label, many: label, primary: label,
  icon: z.enum(ICON_KEYS as [string, ...string[]]),
  key: z.string().regex(FIELD_KEY_RE, "Use lowercase letters, numbers and underscores (2 to 41 characters, starting with a letter)").optional(),
});
export type ObjectInput = z.output<typeof objectInputSchema>;

export const objectUpdateSchema = z.object({
  key: z.string().regex(FIELD_KEY_RE), rev: z.string().min(1).max(64),
  one: label, many: label, icon: z.enum(ICON_KEYS as [string, ...string[]]), enabled: z.boolean(),
});
export type ObjectUpdate = z.output<typeof objectUpdateSchema>;

export const isReservedKey = (k: string): boolean => (RESERVED_KEYS as readonly string[]).includes(k);

/** "Site visit" -> "site_visit"; a reserved result gets an `x_` prefix so the person is never blocked by a word they did not know. */
export function deriveObjectKey(oneEn: string): string {
  const k = keyFromLabel(oneEn);
  const key = k === "field" && !/[a-z]/i.test(oneEn) ? "object" : k;
  return isReservedKey(key) ? `x_${key}`.slice(0, 41) : key;
}

export const ta = (v: string | undefined): string | undefined => (v && v.trim() ? v.trim() : undefined);
/** object_types.label jsonb: { en: {one, many}, ta?: {one, many} }; Tamil is stored only when both forms are given. */
export function labelJson(i: { one: { en: string; ta?: string }; many: { en: string; ta?: string } }): { en: { one: string; many: string }; ta?: { one: string; many: string } } {
  const t1 = ta(i.one.ta), tm = ta(i.many.ta);
  return { en: { one: i.one.en.trim(), many: i.many.en.trim() }, ...(t1 ? { ta: { one: t1, many: tm ?? t1 } } : {}) };
}
