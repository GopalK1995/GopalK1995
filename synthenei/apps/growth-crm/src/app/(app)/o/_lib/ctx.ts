// Server context for a custom-object page: the object definition, its fields, the viewer's permissions and locale.
// Permissions come from the catalogue (obj:<key>.read|write|delete through the authz engine), never from a role name.
// Demo sessions get the labelled example object and never create a Supabase client.
import "server-only";
import { requireActive } from "@/lib/auth/server";
import { can, type ObjectType, type Principal } from "@/lib/authz";
import { loadPrincipal } from "@/lib/authz/load";
import { getLocale } from "@/i18n/server";
import { DbError } from "@/lib/db/errors";
import { getObjectMeta } from "@/lib/metadata/meta";
import { tenantOfWorkspace } from "@/lib/metadata/repo";
import type { FieldDef, ObjectTypeDef } from "@/lib/metadata/types";
import { FIELD_KEY_RE } from "@/lib/metadata/types";
import type { ObjectsLocale } from "@/lib/layouts/strings";
import { demoAccess, demoFields, demoObject, DEMO_OBJECT_KEY } from "./demo";

export const objPerm = (key: string, mode: "read" | "write" | "delete") => `obj:${key}.${mode}`;
export const objType = (key: string) => `obj:${key}` as ObjectType;

export interface ObjectCtx {
  demo: boolean; locale: ObjectsLocale; object: ObjectTypeDef; fields: FieldDef[]; principal: Principal;
  /** Workspace uuid (database) and key (session) of the active workspace. */
  wsUuid: string; wsKey: string; tenantId: string; uid: string; roleKey: string | null; support: boolean;
  access: { read: boolean; write: boolean; delete: boolean };
  can: (mode: "read" | "write" | "delete", rec?: { id?: string; ownerId?: string | null }) => boolean;
  canManageFields: boolean; canShareViews: boolean;
}
export type ObjectCtxResult = { status: "ok"; ctx: ObjectCtx } | { status: "not_found" } | { status: "denied"; locale: ObjectsLocale };

export async function loadObjectCtx(key: string): Promise<ObjectCtxResult> {
  if (!FIELD_KEY_RE.test(key)) return { status: "not_found" };
  const { session, active } = await requireActive();
  const locale: ObjectsLocale = (await getLocale()) === "ta" ? "ta" : "en";
  const principal = await loadPrincipal();
  const demo = session.demo === true;
  let object: ObjectTypeDef, fields: FieldDef[], tenantId = "";
  if (demo) {
    if (key !== DEMO_OBJECT_KEY) return { status: "not_found" };
    object = demoObject(); fields = demoFields();
  } else {
    try {
      const meta = await getObjectMeta(active.ws.uuid, key);
      if (meta.object.kind !== "custom" || !meta.object.isEnabled) return { status: "not_found" };
      object = meta.object; fields = meta.fields;
      tenantId = await tenantOfWorkspace(active.ws.uuid);
    } catch (e) {
      if (e instanceof DbError && e.code === "not_found") return { status: "not_found" };
      throw e;
    }
  }
  const da = demo ? demoAccess(active.role) : null;
  const rec = (rec?: { id?: string; ownerId?: string | null }) => ({ type: objType(key), workspaceId: active.ws.id, ...(rec ?? {}) });
  const can_ = (mode: "read" | "write" | "delete", r?: { id?: string; ownerId?: string | null }) =>
    (da ? da[mode] && !(active.support?.mode === "read_only" && mode !== "read") : can(principal, objPerm(key, mode), rec(r)));
  const access = { read: can_("read"), write: can_("write"), delete: can_("delete") };
  if (!access.read) return { status: "denied", locale };
  return {
    status: "ok",
    ctx: {
      demo, locale, object, fields, principal, wsUuid: active.ws.uuid, wsKey: active.ws.id, tenantId, uid: session.uid, roleKey: principal.roleKey ?? active.role, support: !!active.support,
      access, can: can_, canManageFields: can(principal, "fields.manage"), canShareViews: demo ? active.role === "owner" || active.role === "sales_manager" : can(principal, "views.share"),
    },
  };
}
