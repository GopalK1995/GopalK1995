"use client";
// FieldInput: one labelled control per custom field type. Keyboard operable (native inputs, Radix select, checkbox group
// in a fieldset). The value is the raw draft: strings for typed input, boolean for boolean, string[] for multi-select,
// an ISO instant for datetime. The server coerces and validates (src/lib/metadata/validate.ts), so the UI never decides
// what is valid on its own.
import { useId } from "react";
import { Checkbox, Select, type Option } from "@/components/ui/controls";
import { Field, Input, Textarea } from "@/components/ui/form";
import { isoToIstInput, istInputToIso, normalizePhone } from "@/lib/metadata/format";
import { ft, type FieldsLocale } from "@/lib/metadata/strings";
import type { ClientField } from "@/lib/metadata/runtime";
import { choiceLabel, pickableChoices, pickLabel } from "./labels";

const NONE = "__none__";

export interface FieldInputProps {
  def: ClientField;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
  /** Why the control is disabled; shown as a tooltip on selects and as help text otherwise. */
  disabledReason?: string;
  error?: string;
  locale?: FieldsLocale;
  /** Choices for user and lookup fields, loaded by the page. Without them an id can be pasted. */
  options?: Option[];
  /** Hide the label (table cells, filter rows). The control keeps an aria-label. */
  bare?: boolean;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function FieldInput(p: FieldInputProps) {
  const { def, value, onChange, disabled, disabledReason, error, locale = "en", options, bare } = p;
  const label = pickLabel(def.label, locale);
  const help = [pickLabel(def.help, locale), disabledReason].filter(Boolean).join(" ") || undefined;
  const off = disabled || !!disabledReason;
  const groupId = useId();

  if (def.type === "multi_select") {
    const picked = new Set(Array.isArray(value) ? (value as string[]) : []);
    const choices = pickableChoices(def.choices, value);
    return (
      <fieldset className="grid gap-1" aria-describedby={error ? `${groupId}-e` : undefined} aria-invalid={error ? true : undefined}>
        <legend className="mb-1 text-13 font-medium text-ink">{label}{def.required && <span className="text-danger" aria-hidden> *</span>}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {choices.map((c) => {
            const id = `${groupId}-${c.key}`;
            return (
              <div key={c.key} className="flex items-center gap-2 text-13">
                <Checkbox id={id} checked={picked.has(c.key)} disabled={off}
                  onCheckedChange={(on) => { const n = new Set(picked); if (on === true) n.add(c.key); else n.delete(c.key); onChange([...n]); }} />
                <label htmlFor={id} className="text-ink">{choiceLabel(c, locale)}{c.archived ? ` (${ft("retiredOption", {}, locale)})` : ""}</label>
              </div>
            );
          })}
        </div>
        {help && <p className="text-12 text-ink-3">{help}</p>}
        {error && <p id={`${groupId}-e`} role="alert" className="text-12 text-danger">{error}</p>}
      </fieldset>
    );
  }

  if (def.type === "boolean") {
    const id = `${groupId}-b`;
    return (
      <div className="grid gap-1">
        <div className="flex items-center gap-2 text-13">
          <Checkbox id={id} checked={value === true} disabled={off} onCheckedChange={(on) => onChange(on === true)} aria-describedby={error ? `${id}-e` : undefined} />
          <label htmlFor={id} className="font-medium text-ink">{label}{def.required && <span className="text-danger" aria-hidden> *</span>}</label>
        </div>
        {help && <p className="text-12 text-ink-3">{help}</p>}
        {error && <p id={`${id}-e`} role="alert" className="text-12 text-danger">{error}</p>}
      </div>
    );
  }

  const control = (c: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => {
    switch (def.type) {
      case "long_text":
        return <Textarea {...c} value={str(value)} disabled={off} maxLength={def.maxLength} onChange={(e) => onChange(e.target.value)} aria-label={bare ? label : undefined} />;
      case "number": case "percent": case "rating":
        return <Input {...c} inputMode="decimal" value={str(value)} disabled={off} onChange={(e) => onChange(e.target.value)} className="num-mono" aria-label={bare ? label : undefined} />;
      case "money":
        return (
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-13 text-ink-3" aria-hidden>₹</span>
            <Input {...c} inputMode="decimal" value={str(value)} disabled={off} onChange={(e) => onChange(e.target.value)} className="num-mono pl-6" aria-label={bare ? label : `${label} (INR)`} />
          </div>
        );
      case "date":
        return <Input {...c} type="date" value={str(value)} disabled={off} onChange={(e) => onChange(e.target.value)} className="num-mono" aria-label={bare ? label : undefined} />;
      case "datetime":
        return <Input {...c} type="datetime-local" value={isoToIstInput(str(value))} disabled={off} onChange={(e) => onChange(istInputToIso(e.target.value) ?? "")} className="num-mono" aria-label={bare ? `${label} (IST)` : undefined} />;
      case "phone":
        return <Input {...c} type="tel" inputMode="tel" autoComplete="off" placeholder="+91 98765 43210" value={str(value)} disabled={off} onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => { const n = normalizePhone(e.target.value); if (n && n !== e.target.value) onChange(n); }} className="num-mono" aria-label={bare ? label : undefined} />;
      case "email":
        return <Input {...c} type="email" autoComplete="off" value={str(value)} disabled={off} onChange={(e) => onChange(e.target.value)} aria-label={bare ? label : undefined} />;
      case "url":
        return <Input {...c} type="url" placeholder="https://" value={str(value)} disabled={off} onChange={(e) => onChange(e.target.value)} aria-label={bare ? label : undefined} />;
      case "select": {
        const opts: Option[] = [...(def.required ? [] : [{ value: NONE, label: ft("none", {}, locale) }]),
          ...pickableChoices(def.choices, value).map((ch) => ({ value: ch.key, label: choiceLabel(ch, locale) + (ch.archived ? ` (${ft("retiredOption", {}, locale)})` : "") }))];
        return <Select id={c.id} aria-describedby={c["aria-describedby"]} invalid={c["aria-invalid"]} aria-label={bare ? label : undefined} disabled={disabled} disabledReason={disabledReason}
          value={value ? String(value) : undefined} placeholder={ft("choose", {}, locale)} options={opts} onValueChange={(v) => onChange(v === NONE ? "" : v)} />;
      }
      case "user": case "lookup": {
        if (!options) return <Input {...c} value={str(value)} disabled={off} placeholder={ft("pasteId", {}, locale)} onChange={(e) => onChange(e.target.value)} className="num-mono" aria-label={bare ? label : undefined} />;
        const opts: Option[] = [...(def.required ? [] : [{ value: NONE, label: ft("none", {}, locale) }]), ...options];
        return <Select id={c.id} aria-describedby={c["aria-describedby"]} invalid={c["aria-invalid"]} aria-label={bare ? label : undefined} disabled={disabled} disabledReason={disabledReason}
          value={value ? String(value) : undefined} placeholder={ft("choose", {}, locale)} options={opts} onValueChange={(v) => onChange(v === NONE ? "" : v)} />;
      }
      default:
        return <Input {...c} value={str(value)} disabled={off} maxLength={def.maxLength} onChange={(e) => onChange(e.target.value)} aria-label={bare ? label : undefined} />;
    }
  };

  const hint = def.type === "datetime" ? ft("istHint", {}, locale) : def.type === "phone" ? ft("phoneHint", {}, locale) : null;
  return (
    <Field label={bare ? <span className="sr-only">{label}</span> : label} help={[help, hint].filter(Boolean).join(" ") || undefined} error={error} required={def.required}>
      {control}
    </Field>
  );
}
