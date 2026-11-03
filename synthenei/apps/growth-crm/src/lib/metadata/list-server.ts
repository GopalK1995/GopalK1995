// Server entry for list pages: `const cf = await loadListFields("lead")` then pass `cf.fields` to fieldColumns()/fieldFilterDefs()
// and map rows through `cf.maskRow`. Never imported by client code.
import { requireActive } from "@/lib/auth/server";
import { loadPrincipal } from "@/lib/authz/load";
import { listFieldsFor, type ListFields } from "./list";
import { getObjectMeta } from "./meta";

export async function loadListFields(objectKey: string): Promise<ListFields & { demo: boolean }> {
  const { active } = await requireActive();
  const [principal, meta] = await Promise.all([loadPrincipal(), getObjectMeta(active.ws.uuid, objectKey)]);
  return { ...listFieldsFor(meta.fields, principal, objectKey), demo: meta.demo };
}
