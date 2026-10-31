// Route wrapper for /api/v1: demo 404 -> auth -> rate limit -> scope + permission -> body -> idempotency -> handler -> envelope,
// headers and request log. Every response, success or error, goes through here.
import { randomUUID } from "node:crypto";
import { decide } from "../authz/engine";
import type { Principal, RecordRef } from "../authz/types";
import { loadEnv } from "../env";
import { clientKey } from "../security/rate-limit";
import { authenticateApiKey, type ApiAuth, type AuthDeps } from "./auth";
import { ApiError, problemResponse, toApiError } from "./errors";
import { requestHash, serviceIdempotencyStore, validIdempotencyKey, type IdempotencyStore } from "./idempotency";
import { checkKeyRate, rateHeaders } from "./rate";
import { safePath, serviceRequestLogger, type RequestLogger } from "./request-log";
import { permissionFor, scopeAllows, type ApiAction, type ScopeResource } from "./scopes";

export interface ApiResult { status: number; body?: unknown; headers?: Record<string, string> }
export interface ApiCtx {
  req: Request; url: URL; params: Record<string, string>; body: Record<string, unknown> | null; requestId: string;
  auth: ApiAuth; principal: Principal; db: ApiAuth["db"]; ws: string; permission: string;
  /** Record-level check: out-of-scope records answer 404, other denials 403. */
  authorize(rec: Omit<RecordRef, "workspaceId">, perm?: string): void;
}
export interface RouteSpec {
  resource: ScopeResource;
  action: ApiAction;
  /** Takes a JSON object body (POST, PATCH, and DELETE-with-body are the only methods that read one). */
  body?: "required" | "optional";
  /** Honour the Idempotency-Key header. */
  idempotent?: boolean;
  /** Route param holding the custom object key for `records`. */
  objectParam?: string;
}
export interface Deps extends AuthDeps {
  idempotency?: IdempotencyStore;
  logger?: RequestLogger;
  rate?: typeof checkKeyRate;
  /** Overrides the Supabase-configured check (tests). */
  configured?: () => boolean;
}

const isConfigured = () => loadEnv().supabaseConfigured;
const sanitizeRid = (v: string | null) => (v && /^[A-Za-z0-9._-]{8,64}$/.test(v) ? v : randomUUID());

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), "cache-control": "no-store", ...headers } });
}

async function readBody(req: Request, mode: RouteSpec["body"]): Promise<{ raw: string; json: Record<string, unknown> | null }> {
  if (!mode) return { raw: "", json: null };
  const raw = await req.text();
  if (raw.length > 256 * 1024) throw new ApiError("invalid", "Request body is too large.");
  if (!raw.trim()) {
    if (mode === "required") throw new ApiError("invalid", "A JSON body is required.");
    return { raw, json: null };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new ApiError("invalid", "Body is not valid JSON.", { errors: [{ path: "", message: "invalid JSON" }] }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ApiError("invalid", "Body must be a JSON object.");
  return { raw, json: parsed as Record<string, unknown> };
}

export function route(spec: RouteSpec, fn: (ctx: ApiCtx) => Promise<ApiResult>, deps: Deps = {}) {
  return async function handler(req: Request, routeCtx?: { params?: Promise<Record<string, string>> | Record<string, string> }): Promise<Response> {
    const started = Date.now();
    const requestId = sanitizeRid(req.headers.get("x-request-id"));
    const logger = deps.logger ?? serviceRequestLogger();
    let auth: ApiAuth | null = null;
    let status = 500;
    let hdrs: Record<string, string> = {};
    const finish = (res: Response): Response => {
      status = res.status;
      res.headers.set("x-request-id", requestId);
      for (const [k, v] of Object.entries(hdrs)) res.headers.set(k, v);
      if (auth || status !== 404) {
        void logger.log({
          keyId: auth?.key.id ?? null, tenantId: auth?.key.tenantId ?? null, workspaceId: auth?.key.workspaceId ?? null, method: req.method, path: safePath(req.url),
          status, ms: Date.now() - started, ip: clientKey(req.headers), requestId,
        });
      }
      return res;
    };
    try {
      // Demo deployments have no database: the API does not exist there.
      if (!(deps.configured ?? isConfigured)()) return finish(problemResponse(new ApiError("not_found", "Resource not found."), requestId));
      auth = await authenticateApiKey(req, deps);
      const rate = await (deps.rate ?? checkKeyRate)(auth.key.id);
      hdrs = rateHeaders(rate);
      if (!rate.ok) throw new ApiError("rate_limited", "Rate limit exceeded. Retry after the delay in the Retry-After header.");

      const url = new URL(req.url);
      const params = (await routeCtx?.params) ?? {};
      const permission = permissionFor(spec.resource, spec.action, spec.objectParam ? params[spec.objectParam] : undefined);
      if (!permission) throw new ApiError("not_found", "Resource not found.");
      if (!scopeAllows(auth.key.scopes, spec.resource, spec.action)) {
        throw new ApiError("forbidden", `This key needs the ${spec.resource}:${spec.action === "read" ? "read" : "write"} scope.`, { extra: { reason: "scope" } });
      }
      const p = auth.principal;
      const d = decide(p, permission);
      if (!d.allow) throw new ApiError("forbidden", "Your key is not allowed to do this.", { extra: { reason: d.reason } });

      const { raw, json } = await readBody(req, spec.body);
      const ws = auth.key.workspaceId;
      const ctx: ApiCtx = {
        req, url, params, body: json, requestId, auth, principal: p, db: auth.db, ws, permission,
        authorize(rec, perm) {
          const dd = decide(p, perm ?? permission, { ...rec, workspaceId: ws });
          if (!dd.allow) throw dd.reason === "out_of_scope" || dd.reason === "condition_failed" ? new ApiError("not_found", "Resource not found.") : new ApiError("forbidden", "Your key is not allowed to do this.", { extra: { reason: dd.reason } });
        },
      };

      const idemKey = spec.idempotent ? req.headers.get("idempotency-key") : null;
      if (idemKey !== null && !validIdempotencyKey(idemKey)) throw new ApiError("invalid", "Idempotency-Key must be 8 to 200 printable characters.");
      const store = idemKey ? (deps.idempotency ?? serviceIdempotencyStore()) : null;
      if (idemKey && store) {
        const b = await store.begin(auth.key.id, auth.key.tenantId, idemKey, requestHash(req.method, safePath(req.url) + url.search, raw));
        if (b.state === "replay") return finish(jsonResponse(b.status, b.body, { ...hdrs, "idempotent-replayed": "true", ...(b.status >= 400 ? { "content-type": "application/problem+json" } : {}) }));
        if (b.state === "mismatch") throw new ApiError("conflict", "This Idempotency-Key was already used with a different request.", { extra: { reason: "idempotency_key_reuse" } });
        if (b.state === "inflight") throw new ApiError("conflict", "A request with this Idempotency-Key is still being processed.", { headers: { "Retry-After": "1" }, extra: { reason: "idempotency_in_flight" } });
      }
      let out: ApiResult;
      try {
        out = await fn(ctx);
      } catch (e) {
        if (idemKey && store) {
          const ae = toApiError(e);
          // Client errors are deterministic: replay them. Server errors release the key so a retry can succeed.
          if (ae.status < 500) await store.finish(auth.key.id, idemKey, ae.status, await problemJson(ae, requestId)).catch(() => undefined);
          else await store.abort(auth.key.id, idemKey).catch(() => undefined);
        }
        throw e;
      }
      if (idemKey && store) await store.finish(auth.key.id, idemKey, out.status, out.body ?? null).catch(() => undefined);
      return finish(jsonResponse(out.status, out.body, { ...hdrs, ...(out.headers ?? {}) }));
    } catch (e) {
      const ae = toApiError(e);
      if (ae.code === "error") console.error("api/v1 error", { request_id: requestId, name: e instanceof Error ? e.name : "unknown" });
      return finish(problemResponse(ae, requestId, hdrs));
    }
  };
}

async function problemJson(e: ApiError, requestId: string): Promise<Record<string, unknown>> {
  return (await problemResponse(e, requestId).json()) as Record<string, unknown>;
}

/** Offline-test helper: the permission a route would require. */
export const routePermission = (spec: Pick<RouteSpec, "resource" | "action">, objectKey?: string) => permissionFor(spec.resource, spec.action, objectKey);
