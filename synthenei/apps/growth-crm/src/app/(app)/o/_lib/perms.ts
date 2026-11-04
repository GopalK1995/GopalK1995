// Role editor feed: the obj:<key>.* permissions of the workspace's custom objects, so a new object shows up in Roles & access
// without a code change. Real sessions read object_types (RLS: tenant members); demo shows the example object. Failure -> [].
import "server-only";
import { requireActive } from "@/lib/auth/server";
import type { PermissionDef } from "@/lib/authz/types";
import { objectPermissionDefs } from "@/lib/layouts/object-perms";
import { tenantOfWorkspace } from "@/lib/metadata/repo";
import { from } from "@/lib/db/query";
import { dbForRequest } from "@/lib/db/client";
import { demoObject } from "./demo";

export async function loadObjectPermissionDefs(): Promise<PermissionDef[]> {
  try {
    const { session, active } = await requireActive();
    if (session.demo) { const o = demoObject(); return objectPermissionDefs([{ key: o.key, label: o.label.en.one }]); }
    const tenant = await tenantOfWorkspace(active.ws.uuid);
    const r = await from(await dbForRequest(), "object_types").select("key,label").eq("tenant_id", tenant).eq("kind", "custom").order("position", { ascending: true });
    if (r.error) return [];
    return objectPermissionDefs(((r.data as { key: string; label: { en?: { one?: string } } }[] | null) ?? []).map((x) => ({ key: x.key, label: x.label?.en?.one ?? x.key })));
  } catch { return []; }
}
