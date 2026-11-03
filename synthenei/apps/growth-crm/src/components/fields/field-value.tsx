// FieldValue: read-only display of one custom value. Server- and client-safe (no hooks). Masked values are shown as a
// placeholder with a screen-reader explanation; the real value is never passed in for a viewer without access.
import { Check, EyeOff, X } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { formatDate, formatInr, formatIstDateTime } from "@/lib/metadata/format";
import { ft, type FieldsLocale } from "@/lib/metadata/strings";
import type { ClientField } from "@/lib/metadata/runtime";
import { choiceLabel } from "./labels";

type ValueDef = Pick<ClientField, "type" | "choices">;
const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

export function FieldValue({ def, value, masked = false, locale = "en", resolve }: {
  def: ValueDef; value: unknown; masked?: boolean; locale?: FieldsLocale;
  /** Display name for a user or lookup id (the page passes what it has loaded). */
  resolve?: (id: string) => string | undefined;
}) {
  if (masked) {
    return <span className="inline-flex items-center gap-1 text-ink-3"><EyeOff className="size-3" aria-hidden /><span aria-hidden>••••</span><span className="sr-only">{ft("maskedValue", {}, locale)}</span></span>;
  }
  if (isEmpty(value)) return <span className="text-ink-3"><span aria-hidden>—</span><span className="sr-only">{ft("noValue", {}, locale)}</span></span>;
  switch (def.type) {
    case "number": case "rating": return <span className="num-mono">{typeof value === "number" ? new Intl.NumberFormat("en-IN").format(value) : String(value)}{def.type === "rating" ? <span className="text-ink-3"> / 5</span> : null}</span>;
    case "percent": return <span className="num-mono">{String(value)}%</span>;
    case "money": return <span className="num-mono">{typeof value === "number" ? formatInr(value) : String(value)}</span>;
    case "date": return <span className="num-mono">{formatDate(String(value))}</span>;
    case "datetime": return <span className="num-mono">{formatIstDateTime(String(value))}</span>;
    case "boolean": return value ? <span className="inline-flex items-center gap-1"><Check className="size-3 text-success" aria-hidden />{ft("yes", {}, locale)}</span> : <span className="inline-flex items-center gap-1 text-ink-2"><X className="size-3" aria-hidden />{ft("no", {}, locale)}</span>;
    case "select": {
      const c = def.choices?.find((x) => x.key === value);
      return <Chip tone={c?.color ?? "neutral"}>{c ? choiceLabel(c, locale) : String(value)}{c?.archived ? ` (${ft("retiredOption", {}, locale)})` : ""}</Chip>;
    }
    case "multi_select":
      return <span className="inline-flex flex-wrap gap-1">{(value as string[]).map((k) => { const c = def.choices?.find((x) => x.key === k); return <Chip key={k} tone={c?.color ?? "neutral"}>{c ? choiceLabel(c, locale) : k}</Chip>; })}</span>;
    case "url": {
      const s = String(value);
      return /^https?:\/\//i.test(s) ? <a href={s} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline-offset-2 hover:underline">{s.replace(/^https?:\/\//i, "")}</a> : <span>{s}</span>;
    }
    case "email": return <a href={`mailto:${String(value)}`} className="text-accent underline-offset-2 hover:underline">{String(value)}</a>;
    case "phone": return <a href={`tel:${String(value).replace(/[^+\d]/g, "")}`} className="num-mono text-accent underline-offset-2 hover:underline">{String(value)}</a>;
    case "user": case "lookup": return <span>{resolve?.(String(value)) ?? <span className="num-mono text-ink-2">{String(value).slice(0, 8)}</span>}</span>;
    case "long_text": return <span className="whitespace-pre-wrap">{String(value)}</span>;
    default: return <span>{String(value)}</span>;
  }
}
