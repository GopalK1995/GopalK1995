// Subscription options live in `webhook_endpoints.event_types` because the table has no options column (0015). Reserved entries start
// with "@" and can never match an event type, so the fan-out's pattern match ignores them:
//   "@pii"                     the owner opted in to personal fields (needs pii.read at save time and at send time)
//   "@filter:<field>=<a|b>"    deliver only when data.after[field] (or data[field], or the object type for "object_type") is one of the values
// Needs from integrator: a proper `options jsonb` column; this encoding is the migration source.
import { eventMatches } from "@/lib/jobs/fanout";

export interface EndpointFilter { field: string; values: string[] }
export interface EndpointOptions { pii: boolean; filters: EndpointFilter[] }

const FIELD_RE = /^[a-z][a-z0-9_]{0,40}$/;
const VALUE_RE = /^[A-Za-z0-9_.:@ -]{1,60}$/;
export const MAX_FILTERS = 5;

export function splitEventTypes(stored: string[] | null | undefined): { types: string[]; options: EndpointOptions } {
  const types: string[] = [];
  const options: EndpointOptions = { pii: false, filters: [] };
  for (const e of stored ?? []) {
    if (e === "@pii") { options.pii = true; continue; }
    if (e.startsWith("@filter:")) {
      const m = /^@filter:([a-z][a-z0-9_]*)=(.+)$/.exec(e);
      if (m) options.filters.push({ field: m[1], values: m[2].split("|").filter(Boolean) });
      continue;
    }
    if (!e.startsWith("@")) types.push(e);
  }
  return { types, options };
}

export function joinEventTypes(types: string[], options: EndpointOptions): string[] {
  return [
    ...types,
    ...(options.pii ? ["@pii"] : []),
    ...options.filters.map((f) => `@filter:${f.field}=${f.values.join("|")}`),
  ];
}

/** Returns an error key or null. */
export function validateFilters(filters: EndpointFilter[]): string | null {
  if (filters.length > MAX_FILTERS) return "filterTooMany";
  for (const f of filters) {
    if (!FIELD_RE.test(f.field)) return "filterBadField";
    if (f.values.length === 0 || f.values.length > 10 || f.values.some((v) => !VALUE_RE.test(v))) return "filterBadValue";
  }
  return null;
}

/** AND across filters, OR within one filter's values. */
export function passesFilters(filters: EndpointFilter[], ev: { objectType: string | null; data: Record<string, unknown> }): boolean {
  return filters.every((f) => {
    const after = (ev.data.after ?? {}) as Record<string, unknown>;
    const raw = f.field === "object_type" ? ev.objectType : after[f.field] ?? ev.data[f.field];
    return raw != null && f.values.includes(String(raw));
  });
}

export const subscribes = (types: string[], eventType: string) => types.some((p) => eventMatches(p, eventType));
