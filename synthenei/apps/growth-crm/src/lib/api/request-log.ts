// Request log (api_request_log): method, path, status, duration, ip, request id. Never bodies, query strings, headers or keys.
import { isIP } from "node:net";
import { after } from "next/server";
import { serviceDb } from "../db/service";
import { from } from "../db/query";

export interface LogEntry {
  keyId: string | null; tenantId: string | null; workspaceId: string | null;
  method: string; path: string; status: number; ms: number; ip: string | null; requestId: string;
}
export interface RequestLogger { log(e: LogEntry): Promise<void> }

/** Pathname only: a query string can carry filter values (PII) and a pasted key must never be persisted. */
export function safePath(url: string): string {
  let p: string;
  try { p = new URL(url, "http://x").pathname; } catch { p = "/"; }
  return p.slice(0, 300).replace(/sk_(?:live|test)_[0-9A-Za-z_]+/g, "[redacted]");
}
export const safeIp = (ip: string | null): string | null => (ip && isIP(ip) ? ip : null);

export function serviceRequestLogger(getDb = serviceDb): RequestLogger {
  return {
    async log(e) {
      try {
        await from(getDb(), "api_request_log").insert({
          key_id: e.keyId, tenant_id: e.tenantId, workspace_id: e.workspaceId, method: e.method, path: e.path,
          status: e.status, ms: Math.max(0, Math.round(e.ms)), ip: safeIp(e.ip), request_id: e.requestId,
        });
      } catch { /* logging must never fail a request */ }
    },
  };
}

/** Budget for an inline (awaited) log write when no after() scope exists; a slow log must not slow the response much. */
export const LOG_FLUSH_TIMEOUT_MS = 1500;

/**
 * Makes sure a log write is not lost when the serverless function freezes after the response: registers it with
 * Next's after() (kept alive until it settles) and, outside a request scope or if after() is unavailable, awaits it
 * (bounded by LOG_FLUSH_TIMEOUT_MS) before the response returns. Never throws.
 */
export async function flushLog(p: Promise<void>, schedule: (cb: () => Promise<void>) => void = defaultAfter): Promise<void> {
  try { schedule(() => p); return; } catch { /* no request scope: await below */ }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([p, new Promise<void>((r) => { timer = setTimeout(r, LOG_FLUSH_TIMEOUT_MS); })]);
  } catch { /* logging must never fail a request */ } finally { if (timer) clearTimeout(timer); }
}

function defaultAfter(cb: () => Promise<void>): void { after(cb); }
