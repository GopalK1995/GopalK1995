// Field-map transforms (CONTRACTS C9). Pure and deterministic; a transform that cannot parse its input returns null
// (the engine then rejects the field instead of writing garbage).
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { createHash } from "node:crypto";
import type { TransformKey } from "./types";

export type TransformFn = (v: unknown, arg?: Record<string, unknown> | null) => unknown;

export const e164Phone: TransformFn = (v) => {
  if (v == null || String(v).trim() === "") return null;
  const p = parsePhoneNumberFromString(String(v).trim(), "IN");
  return p && p.isValid() ? p.number : null;
};
export const lowerEmail: TransformFn = (v) => {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
};
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
export const inrPaiseToRupees: TransformFn = (v) => { const n = num(v); return n == null ? null : Math.round(n) / 100; };
export const microsToRupees: TransformFn = (v) => { const n = num(v); return n == null ? null : Math.round(n / 10_000) / 100; };
/** ISO date (YYYY-MM-DD) in IST for a timestamp, epoch seconds/ms or date string. */
export const dateIst: TransformFn = (v) => {
  if (v == null || v === "") return null;
  let d: Date;
  if (typeof v === "number") d = new Date(v < 1e12 ? v * 1000 : v);
  else if (/^\d{10,13}$/.test(String(v))) { const n = Number(v); d = new Date(n < 1e12 ? n * 1000 : n); }
  else d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
};
/** arg: { map: { "<external stage>": "<stage key>" }, fallback?: "<stage key>" }. Unmapped without a fallback is null. */
export const stageKeyMap: TransformFn = (v, arg) => {
  const map = (arg?.map ?? {}) as Record<string, string>;
  const k = v == null ? "" : String(v);
  if (Object.prototype.hasOwnProperty.call(map, k)) return map[k];
  const ci = Object.keys(map).find((m) => m.toLowerCase() === k.toLowerCase());
  if (ci) return map[ci];
  return typeof arg?.fallback === "string" ? arg.fallback : null;
};
export const hashSha256: TransformFn = (v) => (v == null || v === "" ? null : createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex"));
export const trim: TransformFn = (v) => (v == null ? null : String(v).trim());

export const TRANSFORMS: Record<TransformKey, TransformFn> = {
  e164_phone: e164Phone, lower_email: lowerEmail, inr_paise_to_rupees: inrPaiseToRupees, micros_to_rupees: microsToRupees,
  date_ist: dateIst, stage_key_map: stageKeyMap, hash_sha256: hashSha256, trim,
};
export const TRANSFORM_KEYS = Object.keys(TRANSFORMS) as TransformKey[];
export const isTransformKey = (s: string): s is TransformKey => Object.prototype.hasOwnProperty.call(TRANSFORMS, s);
