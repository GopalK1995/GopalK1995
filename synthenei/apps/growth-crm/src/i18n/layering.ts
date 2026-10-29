// Runtime layering: base messages -> vertical preset vocabulary -> tenant vocabulary for the locale -> metadata labels.
import type { Locale } from "./config";
import { BASE, type Messages } from "./registry";

export interface TenantI18nConfig {
  /** Vertical preset vocabulary, already namespaced, e.g. { leads: { title: "Enquiries" } }. */
  presetVocabulary?: Messages;
  /** tenant_config.vocabulary, with per-locale overrides at vocabulary.i18n.<locale>. */
  vocabulary?: { i18n?: Partial<Record<Locale, Messages>> };
}
/** Custom field and stage labels from metadata (label jsonb {en, ta}), keyed by stable id. */
export type MetadataLabels = Record<string, Partial<Record<Locale, string>>>;

const isObj = (v: unknown): v is Messages => typeof v === "object" && v !== null && !Array.isArray(v);
export function mergeMessages(a: Messages, b: Messages | undefined): Messages {
  if (!b) return a;
  const out: Messages = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] = isObj(v) && isObj(cur) ? mergeMessages(cur, v) : v;
  }
  return out;
}

export function messagesFor(locale: Locale, tenantConfig?: TenantI18nConfig, metadataLabels?: MetadataLabels, base: Record<Locale, Messages> = BASE): Messages {
  // English underlies every locale so a missing Tamil key falls back instead of rendering a key name.
  let m = locale === "en" ? base.en : mergeMessages(base.en, base[locale]);
  m = mergeMessages(m, tenantConfig?.presetVocabulary);
  m = mergeMessages(m, tenantConfig?.vocabulary?.i18n?.[locale]);
  if (metadataLabels) {
    const labels: Messages = {};
    for (const [id, l] of Object.entries(metadataLabels)) {
      const text = l[locale] ?? l.en;
      if (text) labels[id] = text;
    }
    m = mergeMessages(m, { labels });
  }
  return m;
}
