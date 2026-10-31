// Label helpers shared by the field components. Pure.
import type { Choice, I18nLabel } from "@/lib/metadata/types";
import type { FieldsLocale } from "@/lib/metadata/strings";

export const pickLabel = (l: I18nLabel | undefined, locale: FieldsLocale = "en"): string => (l ? (locale === "ta" && l.ta ? l.ta : l.en) : "");
export const choiceLabel = (c: Pick<Choice, "label" | "key">, locale: FieldsLocale = "en"): string => pickLabel(c.label, locale) || c.key;
/** Pickable choices; a retired choice that is the current value stays in the list so it still renders. */
export function pickableChoices(choices: Choice[] | undefined, current: unknown): Choice[] {
  const cur = new Set(Array.isArray(current) ? current.map(String) : current == null ? [] : [String(current)]);
  return (choices ?? []).filter((c) => !c.archived || cur.has(c.key));
}
