// Non-CRUD endpoints: me, pipelines, fields, webhooks (REST-hook subscribe for Zapier and Make).
import { randomUUID } from "node:crypto";
import type { Db } from "../db/client";
import { throwIfError } from "../db/errors";
import { from } from "../db/query";
import { serviceDb } from "../db/service";
import { assertPublicHttpsUrl, SsrfError } from "../security/ssrf";
import { ApiError } from "./errors";
import { parseLimit } from "./filters";
import { route, type Deps } from "./handler";
import { listPage, getRow, type Row } from "./list";
import { randomBase62 } from "./keys";
import { webhookCreate } from "./schemas";
import { itemBody, listBody, serializeRow } from "./serialize";

export function me(deps: Deps = {}) {
  return route({ resource: "me", action: "read" }, async (ctx) => {
    const k = ctx.auth.key;
    const perms = Object.entries(ctx.principal.grants).filter(([, g]) => g.scope !== "none").map(([key, g]) => ({ permission: key, scope: g.scope })).sort((a, b) => a.permission.localeCompare(b.permission));
    return {
      status: 200,
      body: {
        data: {
          key: { id: k.id, name: k.name, prefix: k.prefix, env: k.env, scopes: k.scopes, expires_at: k.expiresAt, created_at: k.createdAt },
          org_id: k.tenantId, workspace_id: k.workspaceId, role: ctx.principal.roleKey, permissions: perms,
        },
      },
    };
  }, deps);
}

export function pipelines(deps: Deps = {}) {
  return route({ resource: "pipelines", action: "read" }, async (ctx) => {
    const ps = await listPage(ctx.db, { table: "pipelines", ws: ctx.ws, softDelete: false, filters: [], limit: parseLimit(ctx.url.searchParams.get("limit")), cursor: ctx.url.searchParams.get("cursor") });
    const ids = ps.rows.map((p) => String(p.id));
    let stages: Row[] = [];
    if (ids.length) {
      const r = await from(ctx.db, "pipeline_stages").select("id,pipeline_id,key,name,label,position,probability,max_days,is_won,is_lost,outcome").in("pipeline_id", ids).order("position", { ascending: true });
      throwIfError(r.error);
      stages = (r.data as Row[] | null) ?? [];
    }
    const data = ps.rows.filter((p) => !p.archived_at).map((p) => ({ ...serializeRow(p), stages: stages.filter((s) => s.pipeline_id === p.id).map(serializeRow) }));
    return { status: 200, body: { data, next_cursor: ps.nextCursor } };
  }, deps);
}

export function fields(deps: Deps = {}) {
  return route({ resource: "fields", action: "read" }, async (ctx) => {
    const object = ctx.url.searchParams.get("object");
    if (!object || !/^[a-z][a-z0-9_]{1,40}$/.test(object)) throw new ApiError("invalid", "The object query parameter is required (for example ?object=lead).", { errors: [{ path: "object", message: "required" }] });
    const ot = await from(ctx.db, "object_types").select("id,key").eq("tenant_id", ctx.auth.key.tenantId).eq("key", object).maybeSingle();
    throwIfError(ot.error);
    if (!ot.data) throw new ApiError("not_found", "Resource not found.");
    const r = await from(ctx.db, "field_defs").select("key,label,type,options,required,is_filterable,is_pii,is_searchable,section,position").eq("object_type_id", (ot.data as { id: string }).id).is("archived_at", null).order("position", { ascending: true });
    throwIfError(r.error);
    return { status: 200, body: { data: ((r.data as Row[] | null) ?? []).map((f) => ({ ...f, path: `custom.${String(f.key)}` })), next_cursor: null } };
  }, deps);
}

const WEBHOOK_COLS = "id,tenant_id,workspace_id,url,description,event_types,active,disabled_reason,consecutive_failures,created_at";
/** Narrow view of the builder: delete is not part of the shared Qb type. */
type DeleteBuilder = { from(t: string): { delete(): { eq(c: string, v: string): { eq(c: string, v: string): { select(c?: string): PromiseLike<{ data: unknown; error: { code?: string } | null }> } } } } };

export function webhooksCollection(deps: Deps = {}, vault: () => Db = serviceDb) {
  const GET = route({ resource: "webhooks", action: "read" }, async (ctx) => {
    const r = await from(ctx.db, "webhook_endpoints").select(WEBHOOK_COLS).eq("workspace_id", ctx.ws).order("created_at", { ascending: false }).limit(parseLimit(ctx.url.searchParams.get("limit")));
    throwIfError(r.error);
    return { status: 200, body: listBody((r.data as Row[] | null) ?? [], null) };
  }, deps);
  const POST = route({ resource: "webhooks", action: "create", body: "required", idempotent: true }, async (ctx) => {
    const b = webhookCreate.parse(ctx.body);
    try { await assertPublicHttpsUrl(b.url); } catch (e) {
      if (e instanceof SsrfError) throw new ApiError("invalid", "The url must be a public https address.", { errors: [{ path: "url", message: "must be a public https address" }] });
      throw e;
    }
    const secret = `whsec_${randomBase62(40)}`;
    const sid = await (vault() as unknown as { rpc(f: string, a: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> })
      .rpc("vault_put_secret", { p_name: `webhook:${randomUUID()}`, p_secret: secret, p_desc: "REST hook signing secret" });
    if (sid.error || typeof sid.data !== "string") throw new ApiError("error", "Something went wrong on our side.");
    const ins = await from(ctx.db, "webhook_endpoints").insert({
      workspace_id: ctx.ws, url: b.url, description: b.description ?? null, event_types: b.event_types, secret_id: sid.data, created_by: ctx.auth.key.botUserId,
    }).select(WEBHOOK_COLS).single();
    if (ins.error) {
      await (vault() as unknown as { rpc(f: string, a: Record<string, unknown>): PromiseLike<unknown> }).rpc("vault_delete_secret", { p_id: sid.data });
      throwIfError(ins.error);
    }
    // The signing secret is shown here once and never readable again.
    return { status: 201, body: { data: { ...serializeRow(ins.data as Row), secret } } };
  }, deps);
  return { GET, POST };
}

export function webhooksItem(deps: Deps = {}, vault: () => Db = serviceDb) {
  const DELETE = route({ resource: "webhooks", action: "delete" }, async (ctx) => {
    const row = await getRow(ctx.db, "webhook_endpoints", ctx.ws, ctx.params.id, { softDelete: false });
    if (!row) throw new ApiError("not_found", "Resource not found.");
    const del = await (ctx.db as unknown as DeleteBuilder).from("webhook_endpoints").delete().eq("workspace_id", ctx.ws).eq("id", String(row.id)).select("id");
    throwIfError(del.error);
    if (((del.data as unknown[] | null) ?? []).length === 0) throw new ApiError("not_found", "Resource not found.");
    for (const sid of [row.secret_id, row.previous_secret_id]) {
      if (typeof sid === "string") await (vault() as unknown as { rpc(f: string, a: Record<string, unknown>): PromiseLike<unknown> }).rpc("vault_delete_secret", { p_id: sid }).then(undefined, () => undefined);
    }
    return { status: 204 };
  }, deps);
  const GET = route({ resource: "webhooks", action: "read" }, async (ctx) => {
    const r = await from(ctx.db, "webhook_endpoints").select(WEBHOOK_COLS).eq("workspace_id", ctx.ws).eq("id", ctx.params.id).maybeSingle();
    throwIfError(r.error);
    if (!r.data) throw new ApiError("not_found", "Resource not found.");
    return { status: 200, body: itemBody(r.data as Row) };
  }, deps);
  return { GET, DELETE };
}
