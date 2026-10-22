// deepMerge(base, overrides): overrides replace leaves and arrays; keys that do not exist in `base` are ignored
// (the base is the full effective shape, so this is the second allow-list after validateOverrides), and
// prototype-polluting keys never pass. `diffOverrides` is the inverse: the sparse document to store.
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const BAD = new Set(["__proto__", "constructor", "prototype"]);

export function deepMerge<T>(base: T, over: unknown): T {
  if (over === undefined) return base;
  if (!isObj(base)) return (Array.isArray(base) ? (Array.isArray(over) ? over : base) : typeof over === typeof base || base === null ? over : base) as T;
  if (!isObj(over)) return base;
  const out: Record<string, unknown> = { ...base };
  const open = Object.keys(base).length === 0; // an empty base object is an open map (import column mappings)
  for (const k of Object.keys(over)) {
    if (BAD.has(k) || (!open && !(k in base))) continue;
    out[k] = open ? over[k] : deepMerge((base as Record<string, unknown>)[k], over[k]);
  }
  return out as T;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Smallest document that, merged over `base`, yields `next`. Objects recurse; arrays and scalars compare whole. */
export function diffOverrides(base: unknown, next: unknown): unknown {
  if (isObj(base) && isObj(next)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(next)) {
      if (BAD.has(k)) continue;
      const d = diffOverrides(base[k], next[k]);
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return same(base, next) ? undefined : next;
}
