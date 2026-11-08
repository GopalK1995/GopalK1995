// Server helpers shared by the import actions and pages. Not a "use server" file, so it may export types and constants.
import "server-only";
import { getT } from "@/i18n/server";
import { requireActive } from "@/lib/auth/server";
import { vocabFor, cap } from "@/lib/vertical";
import { getObjectMeta } from "@/lib/metadata/meta";
import { isImportObject, type ImportObject, type TargetField } from "@/lib/import/types";
import { targetsFor } from "@/lib/import/targets";
import type { ObjectOption } from "../types";

export type T = Awaited<ReturnType<typeof getT>>;

export async function importT(): Promise<T> { return getT("imports"); }

/** Object labels in the tenant's own words: leads and accounts come from the vocabulary, contacts from the namespace. */
export async function objectOptions(t: T): Promise<ObjectOption[]> {
  const { active } = await requireActive();
  const n = vocabFor(active.tenant).n;
  return [
    { key: "lead", label: cap(n.lead.many) },
    { key: "account", label: cap(n.firm.many) },
    { key: "contact", label: t("objects.contact") },
  ];
}

/** Target fields for an object: standard columns plus the workspace's field_defs. */
export async function targetsOf(object: ImportObject, t: T): Promise<TargetField[]> {
  const { active } = await requireActive();
  let defs: Awaited<ReturnType<typeof getObjectMeta>>["fields"] = [];
  try { defs = (await getObjectMeta(active.ws.uuid, object)).fields; } catch { /* metadata unavailable: standard columns only */ }
  return targetsFor(object, (k) => t(`fields.${k}`), defs);
}

export { isImportObject };
