// Generic collection and item handlers over the repositories (src/lib/db/repo). One definition per resource; route files are thin.
import type { ZodType } from "zod";
import type { ObjectType } from "../authz/types";
import type { Db } from "../db/client";
import { DbError } from "../db/errors";
import {
  createAccountsRepo, createActivitiesRepo, createContactsRepo, createDealsRepo, createLeadsRepo, createTasksRepo,
} from "../db/repo";
import { makeRepo } from "../db/repo/base";
import { from } from "../db/query";
import { ApiError } from "./errors";
import { parseFilters, parseLimit, type FieldSpec } from "./filters";
import { getRow, listPage, type Row } from "./list";
import { route, type ApiCtx, type Deps } from "./handler";
import * as S from "./schemas";
import { itemBody, listBody, toDbInput } from "./serialize";
import type { ScopeResource } from "./scopes";

export interface Repo {
  create(ws: string, input: never): Promise<Row>;
  update?(ws: string, id: string, v: number, patch: never): Promise<Row>;
  updatePlain?(ws: string, id: string, patch: never): Promise<Row>;
  softDelete?(ws: string, id: string, v: number): Promise<void>;
}
export interface ResourceDef {
  name: string;
  scope: ScopeResource;
  table: string;
  objectType: ObjectType;
  ownerField: "owner_id" | "assignee_id";
  softDelete: boolean;
  versioned: boolean;
  customCol: "custom" | "data";
  filters: Record<string, FieldSpec>;
  createSchema?: ZodType;
  updateSchema?: ZodType;
  repo(db: Db): Repo;
  /** Fix up input before the repo sees it (e.g. stage_key to stage_id). */
  prepareCreate?(ctx: ApiCtx, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  canDelete?: boolean;
}
const asDb = (db: Db) => () => Promise.resolve(db);
const R = (r: unknown) => r as Repo;

export const RESOURCES: Record<string, ResourceDef> = {
  leads: {
    name: "leads", scope: "leads", table: "leads", objectType: "lead", ownerField: "owner_id", softDelete: true, versioned: true, customCol: "custom",
    filters: S.FILTERS.leads, createSchema: S.leadCreate, updateSchema: S.leadUpdate, canDelete: true, repo: (db) => R(createLeadsRepo(asDb(db))),
  },
  contacts: {
    name: "contacts", scope: "contacts", table: "contacts", objectType: "contact", ownerField: "owner_id", softDelete: true, versioned: true, customCol: "custom",
    filters: S.FILTERS.contacts, createSchema: S.contactCreate, updateSchema: S.contactUpdate, canDelete: true, repo: (db) => R(createContactsRepo(asDb(db))),
  },
  accounts: {
    name: "accounts", scope: "accounts", table: "accounts", objectType: "account", ownerField: "owner_id", softDelete: true, versioned: true, customCol: "custom",
    filters: S.FILTERS.accounts, createSchema: S.accountCreate, updateSchema: S.accountUpdate, canDelete: true, repo: (db) => R(createAccountsRepo(asDb(db))),
  },
  deals: {
    name: "deals", scope: "deals", table: "deals", objectType: "deal", ownerField: "owner_id", softDelete: true, versioned: true, customCol: "custom",
    filters: S.FILTERS.deals, createSchema: S.dealCreate, updateSchema: S.dealUpdate, canDelete: true, repo: (db) => R(createDealsRepo(asDb(db))),
    async prepareCreate(ctx, input) {
      const { stage_key, ...rest } = input as { stage_key?: string } & Record<string, unknown>;
      if (rest.stage_id) return rest;
      if (!stage_key) throw new ApiError("invalid", "stage_key or stage_id is required.", { errors: [{ path: "stage_key", message: "required" }] });
      const st = await from(ctx.db, "pipeline_stages").select("id").eq("tenant_id", ctx.auth.key.tenantId).eq("key", stage_key).maybeSingle();
      if (st.error || !st.data) throw new ApiError("invalid", "Unknown stage_key.", { errors: [{ path: "stage_key", message: "unknown stage" }] });
      return { ...rest, stage_id: (st.data as { id: string }).id };
    },
  },
  tasks: {
    name: "tasks", scope: "tasks", table: "tasks", objectType: "task", ownerField: "assignee_id", softDelete: false, versioned: true, customCol: "custom",
    filters: S.FILTERS.tasks, createSchema: S.taskCreate, updateSchema: S.taskUpdate, repo: (db) => R(createTasksRepo(asDb(db))),
  },
  activities: {
    name: "activities", scope: "activities", table: "activities", objectType: "activity", ownerField: "owner_id", softDelete: false, versioned: false, customCol: "custom",
    filters: S.FILTERS.activities, createSchema: S.activityCreate, repo: (db) => R(createActivitiesRepo(asDb(db))),
    async prepareCreate(_ctx, input) { return { source: "api", ...input }; },
  },
  campaigns: {
    name: "campaigns", scope: "campaigns", table: "campaigns", objectType: "campaign", ownerField: "owner_id", softDelete: false, versioned: true, customCol: "custom",
    filters: S.FILTERS.campaigns, repo: () => { throw new Error("campaigns are read-only"); },
  },
};

const ownerOf = (row: Row, f: ResourceDef["ownerField"]) => (row[f] as string | null | undefined) ?? null;
const recRef = (def: ResourceDef, row: Row) => ({ type: def.objectType, id: String(row.id), ownerId: def.ownerField === "owner_id" ? ownerOf(row, "owner_id") : null, assigneeId: def.ownerField === "assignee_id" ? ownerOf(row, "assignee_id") : null });

function parseBody<T>(schema: ZodType<T> | undefined, body: Record<string, unknown> | null): T {
  if (!schema || !body) throw new ApiError("invalid", "A JSON body is required.");
  return schema.parse(body);
}

export function collection(def: ResourceDef, deps: Deps = {}) {
  const GET = route({ resource: def.scope, action: "read" }, async (ctx) => {
    const filters = parseFilters(ctx.url.searchParams, def.filters, def.customCol === "custom");
    const page = await listPage(ctx.db, {
      table: def.table, ws: ctx.ws, softDelete: def.softDelete, filters, cursor: ctx.url.searchParams.get("cursor"), limit: parseLimit(ctx.url.searchParams.get("limit")),
    });
    return { status: 200, body: listBody(page.rows, page.nextCursor) };
  }, deps);
  if (!def.createSchema) return { GET };
  const POST = route({ resource: def.scope, action: "create", body: "required", idempotent: true }, async (ctx) => {
    let input = toDbInput(parseBody(def.createSchema, ctx.body) as Record<string, unknown>);
    if (def.prepareCreate) input = await def.prepareCreate(ctx, input);
    // The new record must be creatable for the caller under their own scope (e.g. a rep may only create records they own).
    ctx.authorize({ type: def.objectType, ownerId: (input[def.ownerField] as string | undefined) ?? ctx.auth.key.botUserId, assigneeId: def.ownerField === "assignee_id" ? ((input.assignee_id as string | undefined) ?? ctx.auth.key.botUserId) : null });
    const row = await def.repo(ctx.db).create(ctx.ws, input as never);
    return { status: 201, body: itemBody(row), headers: { location: `${ctx.url.pathname.replace(/\/$/, "")}/${String(row.id)}` } };
  }, deps);
  return { GET, POST };
}

export function item(def: ResourceDef, deps: Deps = {}) {
  const load = async (ctx: ApiCtx): Promise<Row> => {
    const row = await getRow(ctx.db, def.table, ctx.ws, ctx.params.id, { softDelete: def.softDelete });
    // Foreign tenant, foreign workspace, deleted, out of RLS scope: all the same answer.
    if (!row) throw new ApiError("not_found", "Resource not found.");
    return row;
  };
  const GET = route({ resource: def.scope, action: "read" }, async (ctx) => {
    const row = await load(ctx);
    ctx.authorize(recRef(def, row));
    return { status: 200, body: itemBody(row) };
  }, deps);
  if (!def.updateSchema) return { GET };
  const PATCH = route({ resource: def.scope, action: "update", body: "required", idempotent: true }, async (ctx) => {
    const row = await load(ctx);
    ctx.authorize(recRef(def, row));
    const { expected_version, ...patch } = parseBody(def.updateSchema, ctx.body) as { expected_version?: number } & Record<string, unknown>;
    const repo = def.repo(ctx.db);
    const input = toDbInput(patch);
    let out: Row;
    if (def.versioned) {
      if (!repo.update) throw new ApiError("error", "Something went wrong on our side.");
      out = await repo.update(ctx.ws, String(row.id), expected_version ?? Number(row.version), input as never);
    } else {
      if (!repo.updatePlain) throw new ApiError("error", "Something went wrong on our side.");
      out = await repo.updatePlain(ctx.ws, String(row.id), input as never);
    }
    return { status: 200, body: itemBody(out) };
  }, deps);
  if (!def.canDelete) return { GET, PATCH };
  const DELETE = route({ resource: def.scope, action: "delete" }, async (ctx) => {
    const row = await load(ctx);
    ctx.authorize(recRef(def, row));
    const repo = def.repo(ctx.db);
    if (!repo.softDelete) throw new DbError("error");
    await repo.softDelete(ctx.ws, String(row.id), Number(row.version));
    return { status: 204 };
  }, deps);
  return { GET, PATCH, DELETE };
}

/** POST /deals/{id}/move */
export function dealMove(deps: Deps = {}) {
  const def = RESOURCES.deals;
  return route({ resource: "deals", action: "move", body: "required", idempotent: true }, async (ctx) => {
    const row = await getRow(ctx.db, "deals", ctx.ws, ctx.params.id);
    if (!row) throw new ApiError("not_found", "Resource not found.");
    ctx.authorize(recRef(def, row));
    const b = S.dealMove.parse(ctx.body);
    const repo = createDealsRepo(asDb(ctx.db));
    const out = await repo.move(ctx.ws, String(row.id), b.stage_key, b.expected_version, b.lost_reason ? ({ lostReason: b.lost_reason } as never) : {});
    return { status: 200, body: itemBody(out as unknown as Row) };
  }, deps);
}

/** records/{object} (custom objects). */
export interface ObjectTypeRow { id: string; key: string }
export async function resolveObjectType(db: Db, tenantId: string, key: string): Promise<ObjectTypeRow> {
  const r = await from(db, "object_types").select("id,key").eq("tenant_id", tenantId).eq("key", key).eq("is_enabled", true).maybeSingle();
  if (r.error || !r.data) throw new ApiError("not_found", "Resource not found.");
  return r.data as ObjectTypeRow;
}
export function recordsCollection(deps: Deps = {}) {
  const GET = route({ resource: "records", action: "read", objectParam: "object" }, async (ctx) => {
    const ot = await resolveObjectType(ctx.db, ctx.auth.key.tenantId, ctx.params.object);
    const filters = parseFilters(ctx.url.searchParams, S.FILTERS.records, true);
    const page = await listPage(ctx.db, { table: "records", ws: ctx.ws, customCol: "data", eq: { object_type_id: ot.id }, filters, cursor: ctx.url.searchParams.get("cursor"), limit: parseLimit(ctx.url.searchParams.get("limit")) });
    return { status: 200, body: listBody(page.rows, page.nextCursor) };
  }, deps);
  const POST = route({ resource: "records", action: "create", body: "required", idempotent: true, objectParam: "object" }, async (ctx) => {
    const ot = await resolveObjectType(ctx.db, ctx.auth.key.tenantId, ctx.params.object);
    const b = S.recordCreate.parse(ctx.body);
    const input = { ...toDbInput(b, { customCol: "data" }), object_type_id: ot.id };
    ctx.authorize({ type: `obj:${ot.key}`, ownerId: b.owner_id ?? ctx.auth.key.botUserId });
    const row = await makeRepo<Row & { id: string }, Record<string, unknown>>({ table: "records", softDelete: true }, asDb(ctx.db)).create(ctx.ws, input);
    return { status: 201, body: itemBody(row), headers: { location: `${ctx.url.pathname.replace(/\/$/, "")}/${String(row.id)}` } };
  }, deps);
  return { GET, POST };
}
export function recordsItem(deps: Deps = {}) {
  const repo = (ctx: ApiCtx) => makeRepo<Row & { id: string }, Record<string, unknown>>({ table: "records", softDelete: true }, asDb(ctx.db));
  const load = async (ctx: ApiCtx) => {
    const ot = await resolveObjectType(ctx.db, ctx.auth.key.tenantId, ctx.params.object);
    const row = await getRow(ctx.db, "records", ctx.ws, ctx.params.id, { eq: { object_type_id: ot.id } });
    if (!row) throw new ApiError("not_found", "Resource not found.");
    ctx.authorize({ type: `obj:${ot.key}`, id: String(row.id), ownerId: (row.owner_id as string | null) ?? null });
    return row;
  };
  const GET = route({ resource: "records", action: "read", objectParam: "object" }, async (ctx) => ({ status: 200, body: itemBody(await load(ctx)) }), deps);
  const PATCH = route({ resource: "records", action: "update", body: "required", idempotent: true, objectParam: "object" }, async (ctx) => {
    const row = await load(ctx);
    const { expected_version, ...patch } = S.recordUpdate.parse(ctx.body);
    const out = await repo(ctx).updateV(ctx.ws, String(row.id), expected_version ?? Number(row.version), toDbInput(patch, { customCol: "data" }));
    return { status: 200, body: itemBody(out) };
  }, deps);
  const DELETE = route({ resource: "records", action: "delete", objectParam: "object" }, async (ctx) => {
    const row = await load(ctx);
    await repo(ctx).softDeleteV(ctx.ws, String(row.id), Number(row.version));
    return { status: 204 };
  }, deps);
  return { GET, PATCH, DELETE };
}
