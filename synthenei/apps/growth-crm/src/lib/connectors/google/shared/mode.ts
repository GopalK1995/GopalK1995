// Showcase (mock) mode switch shared by the three connectors: the sandbox token, or APP_ENV=demo without credentials, selects the mock
// gateway; it is refused in production, so a tenant presenting the sandbox token there gets a credential error, never a fake "connected".
import { CredentialError, type ConnectionRow, type ConnectionSecrets } from "../../core/types";
import { CRED, MOCK_TOKEN } from "./constants";

type Env = Record<string, string | undefined>;
export const isMockCredentials = (s: ConnectionSecrets): boolean => s[CRED.accessToken] === MOCK_TOKEN;
export const mockAllowed = (env: Env): boolean => env.APP_ENV !== "production";

/** True when the mock gateway should serve this connection. Throws in production for the sandbox token. */
export function shouldMock(secrets: ConnectionSecrets, env: Env): boolean {
  const demo = env.APP_ENV === "demo";
  if (isMockCredentials(secrets) || (demo && !secrets[CRED.accessToken])) {
    if (!mockAllowed(env)) throw new CredentialError("The sandbox token is not accepted in production");
    return true;
  }
  return false;
}
export const baseOf = (env: Env, name: string, fallback: string): string => (env[name] ?? "").trim() || fallback;

/** Tenant scope carried by every store call. */
export interface ConnScope { tenantId: string; workspaceId: string; connectionId: string }
export const scopeOf = (c: ConnectionRow): ConnScope => ({ tenantId: c.tenantId, workspaceId: c.workspaceId, connectionId: c.id });

export const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
export const count = (v: unknown): number => { const n = num(v); return n !== null && n > 0 ? Math.floor(n) : 0; };
