// Applies a detail layout to the fields a viewer may see. Pure and client-safe. Fields the layout does not place are not shown
// for this viewer (same rule as the custom-object page); an empty layout therefore shows nothing, by design.
import type { ClientField } from "@/lib/metadata/runtime";
import type { DetailSpec } from "./spec";

export function placeFields(fields: ClientField[], spec: DetailSpec, untitled: string): ClientField[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  return spec.sections.flatMap((s) => s.fields.flatMap((k) => { const f = byKey.get(k); return f ? [{ ...f, section: s.title || untitled }] : []; }));
}
