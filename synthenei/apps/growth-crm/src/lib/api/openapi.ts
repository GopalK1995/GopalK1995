// OpenAPI 3.1 document for /api/v1, generated from the zod request schemas (z.toJSONSchema) and the resource registry.
import { z, type ZodType } from "zod";
import { ALL_SCOPES } from "./scopes";
import * as S from "./schemas";

const json = (schema: ZodType): Record<string, unknown> => {
  const { $schema: _s, ...rest } = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any" }) as Record<string, unknown>;
  void _s;
  return rest;
};

const problemRef = { $ref: "#/components/schemas/Problem" };
const errResp = (description: string) => ({ description, content: { "application/problem+json": { schema: problemRef } } });
const pageParams = [
  { name: "cursor", in: "query", schema: { type: "string" }, description: "Opaque cursor from next_cursor." },
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
];
const filterParam = { name: "filter[field]", in: "query", schema: { type: "string" }, description: "Equality filter on a listed field; filter[field][gte|lte|in|contains|neq] and filter[custom.<key>] are supported." };
const idemHeader = { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", minLength: 8, maxLength: 200 }, description: "Replays the stored response for 24 hours." };
const idPath = { name: "id", in: "path", required: true, schema: { type: "string" } };

type Op = Record<string, unknown>;
function op(summary: string, scope: string | null, o: { query?: unknown[]; body?: ZodType; created?: boolean; list?: boolean; noContent?: boolean; idem?: boolean; params?: unknown[] } = {}): Op {
  const ok = o.noContent ? { "204": { description: "Deleted." } }
    : { [o.created ? "201" : "200"]: { description: "OK", content: { "application/json": { schema: { type: "object", properties: { data: o.list ? { type: "array", items: { type: "object" } } : { type: "object" }, ...(o.list ? { next_cursor: { type: ["string", "null"] } } : {}) } } } } } };
  return {
    summary, security: [{ bearerAuth: [] }], ...(scope ? { "x-required-scope": scope } : {}),
    parameters: [...(o.params ?? []), ...(o.query ?? []), ...(o.idem ? [idemHeader] : [])],
    ...(o.body ? { requestBody: { required: true, content: { "application/json": { schema: json(o.body) } } } } : {}),
    responses: { ...ok, "401": errResp("Missing, invalid, expired or revoked key."), "403": errResp("Scope or permission missing."), "404": errResp("Not found, or not visible to this key."), "409": errResp("Conflict or idempotency reuse."), "422": errResp("Validation failed."), "429": errResp("Rate limit exceeded.") },
  };
}

interface Res { path: string; tag: string; scope: string; create?: ZodType; update?: ZodType; del?: boolean }
const RES: Res[] = [
  { path: "leads", tag: "Leads", scope: "leads", create: S.leadCreate, update: S.leadUpdate, del: true },
  { path: "contacts", tag: "Contacts", scope: "contacts", create: S.contactCreate, update: S.contactUpdate, del: true },
  { path: "accounts", tag: "Accounts", scope: "accounts", create: S.accountCreate, update: S.accountUpdate, del: true },
  { path: "deals", tag: "Deals", scope: "deals", create: S.dealCreate, update: S.dealUpdate, del: true },
  { path: "tasks", tag: "Tasks", scope: "tasks", create: S.taskCreate, update: S.taskUpdate },
  { path: "activities", tag: "Activities", scope: "activities", create: S.activityCreate },
  { path: "campaigns", tag: "Campaigns", scope: "campaigns" },
];

export function buildOpenApi(baseUrl = "https://app.synthan.app"): Record<string, unknown> {
  const paths: Record<string, Record<string, Op>> = {};
  for (const r of RES) {
    const tag = [r.tag];
    paths[`/${r.path}`] = { get: { ...op(`List ${r.path}`, `${r.scope}:read`, { list: true, query: [...pageParams, filterParam] }), tags: tag } };
    if (r.create) paths[`/${r.path}`].post = { ...op(`Create ${r.path}`, `${r.scope}:write`, { body: r.create, created: true, idem: true }), tags: tag };
    paths[`/${r.path}/{id}`] = { get: { ...op(`Get one of ${r.path}`, `${r.scope}:read`, { params: [idPath] }), tags: tag } };
    if (r.update) paths[`/${r.path}/{id}`].patch = { ...op(`Update ${r.path}`, `${r.scope}:write`, { body: r.update, params: [idPath], idem: true }), tags: tag };
    if (r.del) paths[`/${r.path}/{id}`].delete = { ...op(`Delete ${r.path} (soft)`, `${r.scope}:write`, { noContent: true, params: [idPath] }), tags: tag };
  }
  paths["/deals/{id}/move"] = { post: { ...op("Move a deal to a stage", "deals:write", { body: S.dealMove, params: [idPath], idem: true }), tags: ["Deals"] } };
  const objParam = { name: "object", in: "path", required: true, schema: { type: "string" }, description: "Custom object key." };
  paths["/records/{object}"] = {
    get: { ...op("List records of a custom object", "records:read", { list: true, params: [objParam], query: pageParams }), tags: ["Records"] },
    post: { ...op("Create a record", "records:write", { body: S.recordCreate, created: true, params: [objParam], idem: true }), tags: ["Records"] },
  };
  paths["/records/{object}/{id}"] = {
    get: { ...op("Get a record", "records:read", { params: [objParam, idPath] }), tags: ["Records"] },
    patch: { ...op("Update a record", "records:write", { body: S.recordUpdate, params: [objParam, idPath], idem: true }), tags: ["Records"] },
    delete: { ...op("Delete a record (soft)", "records:write", { noContent: true, params: [objParam, idPath] }), tags: ["Records"] },
  };
  paths["/pipelines"] = { get: { ...op("List pipelines with stages", "pipelines:read", { list: true, query: pageParams }), tags: ["Metadata"] } };
  paths["/fields"] = { get: { ...op("List custom and system field definitions", "fields:read", { query: [{ name: "object", in: "query", required: true, schema: { type: "string" } }] }), tags: ["Metadata"] } };
  paths["/webhooks"] = {
    get: { ...op("List webhook subscriptions", "webhooks:read", { list: true }), tags: ["Webhooks"] },
    post: { ...op("Subscribe a URL (REST hook). The signing secret is returned once.", "webhooks:write", { body: S.webhookCreate, created: true, idem: true }), tags: ["Webhooks"] },
  };
  paths["/webhooks/{id}"] = {
    get: { ...op("Get a subscription", "webhooks:read", { params: [idPath] }), tags: ["Webhooks"] },
    delete: { ...op("Unsubscribe", "webhooks:write", { noContent: true, params: [idPath] }), tags: ["Webhooks"] },
  };
  paths["/me"] = { get: { ...op("The calling key, its workspace and effective permissions", null), tags: ["Account"] } };

  return {
    openapi: "3.1.0",
    info: { title: "Synthan Growth CRM API", version: "1.0.0", description: "Scoped API keys. Effective permission = the key role's grant intersected with its scopes; the same authorization matrix as the app applies. org_id is the public alias of the tenant id. Errors are application/problem+json." },
    servers: [{ url: `${baseUrl.replace(/\/$/, "")}/api/v1` }],
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "sk_live_<prefix>_<secret> or sk_test_<prefix>_<secret>" } },
      schemas: {
        Problem: { type: "object", required: ["type", "title", "status", "detail", "code"], properties: { type: { type: "string" }, title: { type: "string" }, status: { type: "integer" }, detail: { type: "string" }, code: { enum: ["unauthorized", "forbidden", "not_found", "conflict", "invalid", "rate_limited", "error"] }, errors: { type: "array", items: { type: "object", properties: { path: { type: "string" }, message: { type: "string" } } } } } },
      },
    },
    "x-scopes": ALL_SCOPES,
  };
}
