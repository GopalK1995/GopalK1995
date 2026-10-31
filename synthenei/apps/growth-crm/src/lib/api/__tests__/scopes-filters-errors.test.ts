import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError, ERROR_BASE, problemBody, problemResponse, toApiError } from "../errors";
import { parseFilters, parseLimit } from "../filters";
import { ALL_SCOPES, invalidScopes, normalizeScopes, permissionFor, permissionsForScopes, scopeAllows } from "../scopes";
import { FILTERS } from "../schemas";
import { AuthzError } from "../../authz/engine";
import { DbError } from "../../db/errors";
import { PERMISSION_BY_KEY } from "../../authz/catalog";

describe("scopes map onto authz permissions", () => {
  it("every static permission a scope can need exists in the catalogue", () => {
    for (const p of permissionsForScopes(ALL_SCOPES)) expect(PERMISSION_BY_KEY.has(p), p).toBe(true);
  });
  it("read scope allows reads only; write scope implies read", () => {
    expect(scopeAllows(["leads:read"], "leads", "read")).toBe(true);
    for (const a of ["create", "update", "delete", "move"] as const) expect(scopeAllows(["leads:read"], "leads", a)).toBe(false);
    for (const a of ["read", "create", "update", "delete"] as const) expect(scopeAllows(["leads:write"], "leads", a)).toBe(true);
    expect(scopeAllows(["leads:write"], "contacts", "read")).toBe(false);
    expect(scopeAllows([], "leads", "read")).toBe(false);
  });
  it("read-only resources have no write scope and no write route", () => {
    expect(ALL_SCOPES).not.toContain("campaigns:write");
    expect(scopeAllows(["campaigns:write"], "campaigns", "create")).toBe(false);
    expect(permissionFor("campaigns", "create")).toBeNull();
    expect(permissionFor("pipelines", "update")).toBeNull();
  });
  it("maps routes to the permission the UI uses", () => {
    expect(permissionFor("leads", "create")).toBe("leads.create");
    expect(permissionFor("leads", "update")).toBe("leads.write");
    expect(permissionFor("leads", "delete")).toBe("leads.delete");
    expect(permissionFor("deals", "move")).toBe("deals.move");
    expect(permissionFor("webhooks", "create")).toBe("webhooks.manage");
    expect(permissionFor("records", "read", "room")).toBe("obj:room.read");
    expect(permissionFor("records", "create", "room")).toBe("obj:room.write");
    expect(permissionFor("records", "read")).toBeNull();
    expect(permissionFor("records", "read", "Bad Key")).toBeNull();
  });
  it("normalises and validates scope lists", () => {
    expect(normalizeScopes([" leads:read", "leads:read", "a:b"])).toEqual(["a:b", "leads:read"]);
    expect(invalidScopes(["leads:read", "leads:admin", "*"])).toEqual(["leads:admin", "*"]);
  });
});

describe("filter parser", () => {
  const p = (q: string, custom = true) => parseFilters(new URLSearchParams(q), FILTERS.leads, custom);
  it("parses equality, operators and custom filters", () => {
    expect(p("filter[status]=new")).toEqual([{ field: "status", op: "eq", value: "new", custom: false }]);
    expect(p("filter[created_at][gte]=2026-10-01")).toMatchObject([{ field: "created_at", op: "gte" }]);
    expect(p("filter[source][in]=web,ads")).toMatchObject([{ op: "in", value: ["web", "ads"] }]);
    expect(p("filter[custom.room_type]=deluxe")).toEqual([{ field: "room_type", op: "eq", value: "deluxe", custom: true }]);
    expect(p("filter[score][gt]=50")).toMatchObject([{ field: "score", value: 50 }]);
  });
  it("rejects unknown fields, operators, bad values and injection attempts with 422 detail", () => {
    for (const q of ["filter[password]=x", "filter[status][regex]=x", "filter[owner_id]=not-a-uuid", "filter[score]=abc", "filter[custom.a;drop]=x", "filter[custom.A]=x", "filter[status", "filter[custom.k][gt]=1", "filter[owner_id][gt]=3"]) {
      expect(() => p(q), q).toThrow(ApiError);
    }
    expect(() => p("filter[custom.room]=x", false)).toThrow(/not valid/);
    try { p("filter[nope]=1"); } catch (e) { expect((e as ApiError).code).toBe("invalid"); expect((e as ApiError).opts.errors?.[0].path).toBe("filter[nope]"); }
  });
  it("ignores unrelated parameters and caps the number of filters", () => {
    expect(p("cursor=abc&limit=5&foo=bar")).toEqual([]);
    const many = Array.from({ length: 11 }, (_, i) => `filter[custom.k${i}x]=1`).join("&");
    expect(() => p(many)).toThrow(/not valid/);
  });
  it("limit defaults to 50 and is capped at 100", () => {
    expect(parseLimit(null)).toBe(50);
    expect(parseLimit("100")).toBe(100);
    for (const bad of ["0", "101", "-1", "abc", "1.5"]) expect(() => parseLimit(bad)).toThrow(ApiError);
  });
});

describe("error envelope (problem+json)", () => {
  it("has type, title, status, detail, code", () => {
    const b = problemBody(new ApiError("not_found", "Resource not found."), "rid-1");
    expect(b).toEqual({ type: `${ERROR_BASE}not_found`, title: "Not found", status: 404, detail: "Resource not found.", code: "not_found", request_id: "rid-1" });
  });
  it("uses the contract statuses for every code", () => {
    const want = { unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, invalid: 422, rate_limited: 429, error: 500 } as const;
    for (const [code, status] of Object.entries(want)) expect(problemBody(new ApiError(code as keyof typeof want, "x")).status).toBe(status);
  });
  it("responds with application/problem+json and no-store", async () => {
    const r = problemResponse(new ApiError("invalid", "bad", { errors: [{ path: "a", message: "b" }] }), "rid");
    expect(r.status).toBe(422);
    expect(r.headers.get("content-type")).toBe("application/problem+json");
    expect(r.headers.get("x-request-id")).toBe("rid");
    expect((await r.json()).errors).toEqual([{ path: "a", message: "b" }]);
  });
  it("maps zod, authz and db errors without leaking internals", () => {
    const z1 = z.object({ a: z.string() }).safeParse({});
    const e1 = toApiError(!z1.success ? z1.error : null);
    expect(e1.code).toBe("invalid");
    expect(e1.opts.errors?.[0].path).toBe("a");
    const deny = (reason: "out_of_scope" | "no_permission") => new AuthzError({ allow: false, reason, step: 6, permission: "leads.read", maskedFields: [] });
    expect(toApiError(deny("out_of_scope")).code).toBe("not_found");
    expect(toApiError(deny("no_permission")).code).toBe("forbidden");
    expect(toApiError(new DbError("denied", "denied", { detail: "relation leads violates policy" })).code).toBe("forbidden");
    expect(toApiError(new DbError("not_found")).code).toBe("not_found");
    expect(toApiError(new DbError("unique")).code).toBe("conflict");
    const c = toApiError(new DbError("conflict", "conflict", { current: { id: "1", tenantId: "t1", version: 3 } }));
    expect(c.code).toBe("conflict");
    expect(c.opts.extra?.current).toEqual({ id: "1", org_id: "t1", version: 3 });
    const generic = toApiError(new Error("select * from secrets failed at db.internal:5432"));
    expect(generic.code).toBe("error");
    expect(JSON.stringify(problemBody(generic))).not.toMatch(/secrets|5432|select/);
    const sql = toApiError(new DbError("error", "error", { detail: "duplicate key value violates unique constraint api_keys_prefix_key" }));
    expect(JSON.stringify(problemBody(sql))).not.toMatch(/api_keys|constraint/);
  });
});
