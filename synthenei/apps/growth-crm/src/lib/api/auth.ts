// authenticateApiKey (CONTRACTS C11): Bearer key -> prefix lookup -> constant-time hash compare -> revoked/expired checks ->
// 5-minute JWT for the key's bot user -> Supabase client under that JWT (RLS applies) -> Principal from authz.my_grants.
import { createClient } from "@supabase/supabase-js";
import { principalFromMyGrants } from "../authz/principal";
import type { Principal } from "../authz/types";
import type { Db } from "../db/client";
import { from } from "../db/query";
import { serviceDb } from "../db/service";
import { loadEnv } from "../env";
import { ApiError } from "./errors";
import { bearerToken, parseKey, verifyKey, type KeyEnv } from "./keys";
import { mintBotJwt } from "./jwt";

/** Explicit column list: key_hash is column-privilege-revoked from client roles, and `select *` would fail or leak. */
export const KEY_COLUMNS = "id,tenant_id,workspace_id,name,prefix,key_hash,env,scopes,role_id,bot_user_id,created_by,created_at,last_used_at,expires_at,revoked_at";
export const PUBLIC_KEY_COLUMNS = "id,tenant_id,workspace_id,name,prefix,env,scopes,role_id,bot_user_id,created_by,created_at,last_used_at,expires_at,revoked_at";

export interface ApiKeyRow {
  id: string; tenantId: string; workspaceId: string; name: string; prefix: string; keyHash: string; env: KeyEnv; scopes: string[];
  roleId: string | null; botUserId: string | null; createdBy: string | null; createdAt: string; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null;
}
export type PublicKey = Omit<ApiKeyRow, "keyHash">;

export interface KeyStore {
  findByPrefix(prefix: string): Promise<ApiKeyRow | null>;
  touch(id: string, now: number): Promise<void>;
}

type Raw = Record<string, unknown>;
export function rowToKey(r: Raw): ApiKeyRow {
  return {
    id: String(r.id), tenantId: String(r.tenant_id), workspaceId: String(r.workspace_id), name: String(r.name), prefix: String(r.prefix), keyHash: String(r.key_hash ?? ""),
    env: r.env === "test" ? "test" : "live", scopes: Array.isArray(r.scopes) ? (r.scopes as string[]) : [], roleId: (r.role_id as string) ?? null, botUserId: (r.bot_user_id as string) ?? null,
    createdBy: (r.created_by as string) ?? null, createdAt: String(r.created_at), lastUsedAt: (r.last_used_at as string) ?? null, expiresAt: (r.expires_at as string) ?? null, revokedAt: (r.revoked_at as string) ?? null,
  };
}

export function serviceKeyStore(getDb: () => Db = serviceDb): KeyStore {
  return {
    async findByPrefix(prefix) {
      const { data, error } = await from(getDb(), "api_keys").select(KEY_COLUMNS).eq("prefix", prefix).maybeSingle();
      if (error) throw new ApiError("error", "Something went wrong on our side.");
      return data ? rowToKey(data as Raw) : null;
    },
    async touch(id, now) {
      // last_used_at is a hint for the key screen: write at most once a minute per key (the caller throttles).
      await from(getDb(), "api_keys").update({ last_used_at: new Date(now).toISOString() }).eq("id", id);
    },
  };
}

export type KeyState = "ok" | "revoked" | "expired";
export function keyState(k: Pick<ApiKeyRow, "revokedAt" | "expiresAt">, now = Date.now()): KeyState {
  if (k.revokedAt) return "revoked";
  if (k.expiresAt && Date.parse(k.expiresAt) <= now) return "expired";
  return "ok";
}

export interface ApiAuth { key: PublicKey; principal: Principal; db: Db }
export interface AuthDeps {
  store?: KeyStore;
  now?: () => number;
  /** Builds the client that carries the bot JWT. Default: supabase-js with the anon key. */
  makeDb?: (jwt: string) => Db;
  jwtSecret?: string;
  /** Loads authz.my_grants for the bot under its own client. */
  loadGrants?: (db: Db, workspaceId: string) => Promise<unknown>;
}
const TOUCH_EVERY_MS = 60_000;
const unauthorized = () => new ApiError("unauthorized", "Missing, invalid, expired or revoked API key.", { headers: { "WWW-Authenticate": 'Bearer realm="synthan-api"' } });

function defaultMakeDb(jwt: string): Db {
  const e = loadEnv();
  if (!e.supabaseUrl || !e.supabaseAnonKey) throw new ApiError("error", "Something went wrong on our side.");
  return createClient(e.supabaseUrl, e.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as unknown as Db;
}
async function defaultLoadGrants(db: Db, workspaceId: string): Promise<unknown> {
  const { data, error } = await (db as unknown as { schema(s: string): { rpc(f: string, a: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> } })
    .schema("authz").rpc("my_grants", { p_ws: workspaceId });
  if (error) throw new ApiError("error", "Something went wrong on our side.");
  return data;
}

const DUMMY_HASH = "0".repeat(64);

export async function authenticateApiKey(req: { headers: { get(n: string): string | null } }, deps: AuthDeps = {}): Promise<ApiAuth> {
  const now = (deps.now ?? Date.now)();
  const raw = bearerToken(req.headers.get("authorization"));
  const parsed = parseKey(raw);
  if (!raw || !parsed) throw unauthorized();
  const store = deps.store ?? serviceKeyStore();
  const row = await store.findByPrefix(parsed.prefix);
  // Compare even when the prefix is unknown, so timing does not reveal which prefixes exist.
  const match = verifyKey(raw, row?.keyHash ?? DUMMY_HASH);
  if (!row || !match || row.env !== parsed.env) throw unauthorized();
  if (keyState(row, now) !== "ok") throw unauthorized();
  if (!row.botUserId) throw new ApiError("forbidden", "This key has no bot user. Create a new key.");

  const e = loadEnv();
  const secret = deps.jwtSecret ?? e.jwtSecret;
  if (!secret) throw new ApiError("error", "Something went wrong on our side.", { extra: { reason: "jwt_signing_unavailable" } });
  const { token } = mintBotJwt({ sub: row.botUserId, secret, keyId: row.id, issuer: e.supabaseUrl ? `${e.supabaseUrl}/auth/v1` : undefined, now });
  const db = (deps.makeDb ?? defaultMakeDb)(token);
  const grants = await (deps.loadGrants ?? defaultLoadGrants)(db, row.workspaceId);
  const principal = principalFromMyGrants(grants, { uid: row.botUserId, workspaceId: row.workspaceId, kind: "api_key" });
  if (!principal.roleKey) throw unauthorized(); // no membership: the bot is not in the workspace any more

  if (!row.lastUsedAt || now - Date.parse(row.lastUsedAt) > TOUCH_EVERY_MS) void store.touch(row.id, now).catch(() => undefined);
  const { keyHash: _drop, ...key } = row;
  void _drop;
  return { key, principal, db };
}
