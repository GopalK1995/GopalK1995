// Centralised snake_case <-> camelCase mapping for DB rows (top-level keys only; jsonb values are left untouched).
export type CamelKey<S extends string> = S extends `${infer H}_${infer T}` ? `${H}${Capitalize<CamelKey<T>>}` : S;
export type Camelize<T> = { [K in keyof T as K extends string ? CamelKey<K> : K]: T[K] };

export const toCamelKey = (k: string): string => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
export const toSnakeKey = (k: string): string => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export function toCamel<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamelKey(k), v])) as T;
}

/** Drops undefined values so partial patches never null out columns. */
export function toSnake(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [toSnakeKey(k), v]));
}
