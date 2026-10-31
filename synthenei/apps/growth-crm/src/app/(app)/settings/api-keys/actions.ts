"use server";
// Create, rotate and revoke API keys. Every action: zod -> permission gate (api_keys.manage, never in support) -> escalation
// checks -> service-side write. The full key is returned once, in the create/rotate result, and never stored or logged.
import { z } from "zod";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { requireActive } from "@/lib/auth/server";
import { assertCan } from "@/lib/authz/load";
import { AuthzError } from "@/lib/authz/engine";
import { dbForRequest } from "@/lib/db/client";
import { DbError, throwIfError } from "@/lib/db/errors";
import { from } from "@/lib/db/query";
import { createApiKey, revokeApiKey, rotateApiKey } from "@/lib/api/key-admin";
import { checkKeyEscalation, createKeySchema, expiryFrom } from "./_lib/plan";
import { ak } from "./_lib/strings";
import type { IssuedKey } from "./_lib/types";
import type { BaseRole } from "../roles/_lib/guards";

const idSchema = z.object({ id: z.string().uuid() });

async function gate() {
  const { session, active } = await requireActive();
  if (active.support) throw new AuthzError({ allow: false, reason: "support_blocked", step: 4, permission: "api_keys.manage", maskedFields: [] });
  const demo = session.demo === true;
  const principal = await assertCan(demo ? "integrations.manage" : "api_keys.manage");
  let tenantUuid = "";
  if (!demo) {
    // Tenant.uuid is not on the session types yet (T006): read it from the workspace row the caller can see.
    const r = await from(await dbForRequest(), "workspaces").select("tenant_id").eq("id", active.ws.uuid).maybeSingle();
    throwIfError(r.error);
    tenantUuid = String((r.data as { tenant_id?: string } | null)?.tenant_id ?? "");
    if (!tenantUuid) throw new AuthzError({ allow: false, reason: "out_of_scope", step: 1, permission: "api_keys.manage", maskedFields: [] });
  }
  return { demo, uid: session.uid, role: active.role as BaseRole, principal, wsUuid: active.ws.uuid, tenantUuid };
}

export async function createKey(raw: unknown): Promise<ActionResult<IssuedKey>> {
  return runAction<IssuedKey>(async () => {
    const parsed = createKeySchema.safeParse(raw);
    if (!parsed.success) return failResult("invalid", ak("invalidBody"), { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    const c = await gate();
    const esc = checkKeyEscalation({ uid: c.uid, baseRole: c.role, held: c.principal.grants }, c.principal, parsed.data);
    if (!esc.ok) {
      const list = (esc.scopes ?? []).join(", ");
      const msg = esc.code === "role_exceeds_you" ? ak("deny_role_exceeds_you") : esc.code === "scope_not_held" ? ak("deny_scope_not_held", { scopes: list }) : ak("deny_unknown_scope", { scopes: list });
      return failResult("denied", msg);
    }
    if (c.demo) return okResult<IssuedKey>(ak("created"), { sub: ak("demoNotSaved") });
    try {
      const out = await createApiKey({ tenantId: c.tenantUuid, workspaceId: c.wsUuid, createdBy: c.uid, name: parsed.data.name, env: parsed.data.env, role: parsed.data.role, scopes: esc.scopes, expiresAt: expiryFrom(parsed.data.expiresInDays) });
      return okResult<IssuedKey>(ak("created"), { data: { id: out.key.id, name: out.key.name, secret: out.secret, prefix: out.key.prefix, env: out.key.env } });
    } catch (e) {
      if (e instanceof DbError && e.code === "invalid" && e.detail === "key limit reached") return failResult("invalid", ak("limitReached"));
      throw e;
    }
  });
}

export async function rotateKey(raw: unknown): Promise<ActionResult<IssuedKey>> {
  return runAction<IssuedKey>(async () => {
    const parsed = idSchema.safeParse(raw);
    if (!parsed.success) return failResult("invalid", ak("invalidBody"));
    const c = await gate();
    if (c.demo) return okResult<IssuedKey>(ak("rotated"), { sub: ak("demoNotSaved") });
    try {
      const out = await rotateApiKey(c.wsUuid, parsed.data.id);
      return okResult<IssuedKey>(ak("rotated"), { data: { id: out.key.id, name: out.key.name, secret: out.secret, prefix: out.key.prefix, env: out.key.env } });
    } catch (e) {
      if (e instanceof DbError && e.code === "not_found") return failResult("not_found", ak("notFound"));
      throw e;
    }
  });
}

export async function revokeKey(raw: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const parsed = idSchema.safeParse(raw);
    if (!parsed.success) return failResult("invalid", ak("invalidBody"));
    const c = await gate();
    if (c.demo) return okResult(ak("revoked"), { sub: ak("demoNotSaved") });
    try {
      await revokeApiKey(c.wsUuid, parsed.data.id);
      return okResult(ak("revoked"));
    } catch (e) {
      if (e instanceof DbError && e.code === "not_found") return failResult("not_found", ak("notFound"));
      throw e;
    }
  });
}
