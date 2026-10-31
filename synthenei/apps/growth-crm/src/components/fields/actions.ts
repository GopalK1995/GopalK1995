"use server";
// Save custom field values on a record (used by <CustomFields/>). assertCan (list level) -> record-level and field-level
// checks in saveCustomValues -> shared validation -> version-guarded write. Demo sessions validate and return what would
// have happened, and never create a Supabase client. Audit rows and *.updated events come from the DB triggers (0014).
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { requireActive } from "@/lib/auth/server";
import { assertCan, loadPrincipal } from "@/lib/authz/load";
import { getLocale } from "@/i18n/server";
import { getObjectMeta } from "@/lib/metadata/meta";
import { objectNoun } from "@/lib/metadata/labels";
import { saveCustomValues, writePermOf, type SaveOut } from "@/lib/metadata/save";
import { dbSaveDeps } from "@/lib/metadata/save-db";
import { ft } from "@/lib/metadata/strings";
import { validateCustom } from "@/lib/metadata/validate";
import { maskCustomValues } from "@/lib/metadata/access";
import { vocabFor } from "@/lib/vertical";

const inputSchema = z.object({
  objectKey: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  recordId: z.string().min(1).max(64),
  expectedVersion: z.number().int().min(0),
  patch: z.record(z.string().regex(/^[a-z][a-z0-9_]{1,40}$/), z.unknown()).refine((p) => Object.keys(p).length <= 100, "too many fields"),
  revalidate: z.string().max(200).startsWith("/").optional(),
});

export async function saveCustomFields(raw: unknown): Promise<ActionResult<SaveOut>> {
  return runAction<SaveOut>(async () => {
    const parsed = inputSchema.safeParse(raw);
    const { session, active } = await requireActive();
    const locale = (await getLocale()) === "ta" ? "ta" : "en";
    const noun = (key: string) => objectNoun(vocabFor(active.tenant), key).one;
    const mk = (key: string) => (k: string, v: Record<string, string | number> = {}) => ft(k, { noun: noun(key), ...v }, locale);
    if (!parsed.success) return failResult("invalid", ft("invalidBody", {}, locale), { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    const input = parsed.data;
    const t = mk(input.objectKey);
    const principal = await assertCan(writePermOf(input.objectKey));
    const meta = await getObjectMeta(active.ws.uuid, input.objectKey);

    if (session.demo) {
      // Demo records are not stored, so only the keys being changed can be checked (required fields are the record's concern).
      const issues = validateCustom(meta.fields, input.patch, "update").issues.filter((i) => i.path in input.patch);
      if (issues.length) return failResult("invalid", t("fixFields", { n: issues.length }), { issues });
      return okResult<SaveOut>(t("valuesSaved"), { sub: t("demoNotSaved"), data: { version: input.expectedVersion, values: maskCustomValues(meta.fields, input.patch, principal, { objectKey: input.objectKey, canWriteRecord: true }) } });
    }
    const res = await saveCustomValues({ principal: await loadPrincipal(), ws: active.ws.id, defs: meta.fields, deps: dbSaveDeps(), t, locale }, input);
    if (res.ok && input.revalidate) revalidatePath(input.revalidate);
    return res;
  });
}
