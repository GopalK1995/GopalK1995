// Duplicate keys: lower-cased email, E.164 phone, and for accounts the lower-cased name plus city.
import type { ExistingIndex, ImportObject } from "./types";

const squash = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
export const nameCityKey = (name: unknown, city: unknown): string => `${squash(name)}|${squash(city)}`;

export interface DupHit { id: string | null; key: "email" | "phone" | "name_city" }

/** Finds an existing record (or an earlier row in the same file, id null) that this record duplicates. Email first, then phone, then name+city. */
export function findDuplicate(object: ImportObject, rec: Record<string, unknown>, existing: ExistingIndex, seen: ExistingIndex): DupHit | null {
  const email = typeof rec.email === "string" ? rec.email.toLowerCase() : null;
  const phone = typeof rec.phone === "string" ? rec.phone : null;
  if (object !== "account") {
    if (email) { const id = existing.byEmail.get(email); if (id) return { id, key: "email" }; if (seen.byEmail.has(email)) return { id: null, key: "email" }; }
    if (phone) { const id = existing.byPhone.get(phone); if (id) return { id, key: "phone" }; if (seen.byPhone.has(phone)) return { id: null, key: "phone" }; }
  } else if (rec.name) {
    const k = nameCityKey(rec.name, rec.city);
    const id = existing.byNameCity.get(k);
    if (id) return { id, key: "name_city" };
    if (seen.byNameCity.has(k)) return { id: null, key: "name_city" };
  }
  return null;
}

/** Records a row's keys so later rows of the same file can be detected as duplicates of it. */
export function remember(object: ImportObject, rec: Record<string, unknown>, idx: ExistingIndex, id = "in-file"): void {
  if (object !== "account") {
    if (typeof rec.email === "string") idx.byEmail.set(rec.email.toLowerCase(), id);
    if (typeof rec.phone === "string") idx.byPhone.set(rec.phone, id);
  } else if (rec.name) idx.byNameCity.set(nameCityKey(rec.name, rec.city), id);
}

/** Adds one stored row to an index (email and phone, or name+city for accounts). */
export function indexRow(object: ImportObject, row: { id: string; email?: string | null; phone?: string | null; name?: string | null; city?: string | null }, idx: ExistingIndex): void {
  if (object === "account") { if (row.name) idx.byNameCity.set(nameCityKey(row.name, row.city), row.id); return; }
  if (row.email) idx.byEmail.set(row.email.toLowerCase(), row.id);
  if (row.phone) idx.byPhone.set(row.phone, row.id);
}
