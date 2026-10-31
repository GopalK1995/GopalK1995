// Error envelope: application/problem+json (CONTRACTS C11).
import { ZodError } from "zod";
import { AuthzError } from "../authz/engine";
import { DbError } from "../db/errors";

export type ApiCode = "unauthorized" | "forbidden" | "not_found" | "conflict" | "invalid" | "rate_limited" | "error";
export const STATUS: Record<ApiCode, number> = { unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, invalid: 422, rate_limited: 429, error: 500 };
const TITLE: Record<ApiCode, string> = {
  unauthorized: "Unauthorized", forbidden: "Forbidden", not_found: "Not found", conflict: "Conflict",
  invalid: "Invalid request", rate_limited: "Too many requests", error: "Internal error",
};
export const ERROR_BASE = "https://docs.synthan.app/errors/";

export interface FieldIssue { path: string; message: string }
export class ApiError extends Error {
  readonly status: number;
  constructor(public code: ApiCode, public detail: string, public opts: { errors?: FieldIssue[]; headers?: Record<string, string>; extra?: Record<string, unknown> } = {}) {
    super(detail);
    this.name = "ApiError";
    this.status = STATUS[code];
  }
}

export interface Problem { type: string; title: string; status: number; detail: string; code: ApiCode; errors?: FieldIssue[]; request_id?: string; [k: string]: unknown }

export function problemBody(e: ApiError, requestId?: string): Problem {
  return {
    type: `${ERROR_BASE}${e.code}`, title: TITLE[e.code], status: e.status, detail: e.detail, code: e.code,
    ...(e.opts.errors?.length ? { errors: e.opts.errors } : {}), ...(requestId ? { request_id: requestId } : {}), ...(e.opts.extra ?? {}),
  };
}

export function problemResponse(e: ApiError, requestId?: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(problemBody(e, requestId)), {
    status: e.status,
    headers: { "content-type": "application/problem+json", "cache-control": "no-store", ...(requestId ? { "x-request-id": requestId } : {}), ...extraHeaders, ...(e.opts.headers ?? {}) },
  });
}

export const zodIssues = (e: ZodError): FieldIssue[] => e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));

/** Maps anything thrown inside a handler. Messages never include SQL text, table names or stack traces. */
export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof ZodError) return new ApiError("invalid", "Request validation failed.", { errors: zodIssues(e) });
  if (e instanceof AuthzError) {
    // A record outside the caller's scope looks exactly like a missing record.
    return e.decision.reason === "out_of_scope" ? new ApiError("not_found", "Resource not found.") : new ApiError("forbidden", "Your key is not allowed to do this.", { extra: { reason: e.decision.reason } });
  }
  if (e instanceof DbError) {
    switch (e.code) {
      case "denied": return new ApiError("forbidden", "Your key is not allowed to do this.");
      case "not_found": return new ApiError("not_found", "Resource not found.");
      case "conflict": return new ApiError("conflict", "The record changed since you read it.", { extra: e.current !== undefined ? { current: e.current } : {} });
      case "unique": return new ApiError("conflict", "A record with these values already exists.");
      case "invalid": return new ApiError("invalid", "A value was rejected by the database.");
      default: return new ApiError("error", "Something went wrong on our side.");
    }
  }
  return new ApiError("error", "Something went wrong on our side.");
}
