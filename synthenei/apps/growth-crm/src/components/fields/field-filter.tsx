"use client";
// FieldFilter: one filter control for a filterable custom field. Controlled; the page owns the value (URL params or a
// saved view). Operators match the public API (eq, neq, in, contains).
import { Select, type Option } from "@/components/ui/controls";
import { Input } from "@/components/ui/form";
import { opsFor, type FieldFilterValue, type FilterOp } from "@/lib/metadata/filters";
import { ft, type FieldsLocale } from "@/lib/metadata/strings";
import type { ClientField } from "@/lib/metadata/runtime";
import { choiceLabel, pickLabel } from "./labels";

const ANY = "__any__";

export function FieldFilter({ def, value, onChange, locale = "en", options }: {
  def: Pick<ClientField, "key" | "label" | "type" | "choices">;
  value: FieldFilterValue | undefined;
  /** undefined clears the filter. */
  onChange: (next: FieldFilterValue | undefined) => void;
  locale?: FieldsLocale;
  options?: Option[];
}) {
  const label = pickLabel(def.label, locale);
  const ops = opsFor(def);
  const op: FilterOp = value?.op ?? ops[0];
  const set = (v: string | string[]) => (v === "" || (Array.isArray(v) && !v.length) ? onChange(undefined) : onChange({ op, value: v }));
  const choiceOpts: Option[] | null = def.type === "select" || def.type === "multi_select"
    ? (def.choices ?? []).filter((c) => !c.archived).map((c) => ({ value: c.key, label: choiceLabel(c, locale) }))
    : def.type === "boolean" ? [{ value: "true", label: ft("yes", {}, locale) }, { value: "false", label: ft("no", {}, locale) }]
    : (def.type === "user" || def.type === "lookup") && options ? options : null;

  const text = Array.isArray(value?.value) ? value.value.join(",") : (value?.value ?? "");
  return (
    <div role="group" aria-label={ft("filterBy", { label }, locale)} className="flex items-center gap-1.5">
      <span className="text-12 text-ink-2">{label}</span>
      {ops.length > 1 && !(choiceOpts && def.type === "boolean") && (
        <Select aria-label={ft("filterOperator", { label }, locale)} className="min-w-28" value={op} options={ops.map((o) => ({ value: o, label: ft(`op_${o}`, {}, locale) }))}
          onValueChange={(o) => onChange(value ? { op: o as FilterOp, value: o === "in" ? (Array.isArray(value.value) ? value.value : [value.value]) : (Array.isArray(value.value) ? value.value[0] ?? "" : value.value) } : undefined)} />
      )}
      {choiceOpts ? (
        <Select aria-label={label} className="min-w-36" value={typeof text === "string" && text ? text.split(",")[0] : ANY} placeholder={ft("any", {}, locale)}
          options={[{ value: ANY, label: ft("any", {}, locale) }, ...choiceOpts]}
          onValueChange={(v) => (v === ANY ? onChange(undefined) : set(op === "in" || def.type === "multi_select" ? [v] : v))} />
      ) : (
        <Input aria-label={label} className="w-40" value={String(text)} placeholder={ft("typeToFilter", {}, locale)} onChange={(e) => set(e.target.value)} />
      )}
    </div>
  );
}
