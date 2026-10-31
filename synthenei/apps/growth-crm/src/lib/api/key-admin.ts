// Key lifecycle (create, rotate, revoke, list) for the settings screen. Server-only: creating a key provisions a bot user
// through the Supabase admin API and writes the hash with the service role (key_hash is not insertable by clients).
// The caller (server action) has already validated the input and run the escalation checks.
import "server-only";
import type { Db } from "../db/client";
import { DbError, throwIfError } from "../db/errors";
import { from } from "../db/query";
import { serviceDb } from "../db/service";
import { PUBLIC_KEY_COLUMNS, rowToKey, type PublicKey } from "./auth";
import { generateKey, type KeyEnv } from "./keys";

export const MAX_ACTIVE_KEYS = 25;

export interface NewKeyInput {
  tenantId: string; workspaceId: string; createdBy: string; name: string; env: KeyEnv; role: string; scopes: string[]; expiresAt: string | null;
}
export interface CreatedKey { secret: string; key: PublicKey }

type Admin = { auth: { admin: { createUser(a: Record<string, unknown>): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }>; deleteUser(id: string): PromiseLike<unknown> } } };
const admin = (svc: Db) => svc as unknown as Admin;

export async function countActiveKeys(svc: Db, workspaceId: string, now = Date.now()): Promise<number> {
  const r = await from(svc, "api_keys").select("id,expires_at").eq("workspace_id", workspaceId).is("revoked_at", null);
  throwIfError(r.error);
  return ((r.data as { expires_at: string | null }[] | null) ?? []).filter((k) => !k.expires_at || Date.parse(k.expires_at) > now).length;
}

export async function createApiKey(i: NewKeyInput, svc: Db = serviceDb()): Promise<CreatedKey> {
  if ((await countActiveKeys(svc, i.workspaceId)) >= MAX_ACTIVE_KEYS) throw new DbError("invalid", "invalid", { detail: "key limit reached" });
  const gen = generateKey(i.env);
  const nonce = gen.prefix.toLowerCase();
  // A bot user: an auth user that never confirms its address and has no password, so it can only act through a minted JWT.
  const created = await admin(svc).auth.admin.createUser({ email: `api-${nonce}-${Date.now().toString(36)}@bots.synthan.invalid`, email_confirm: false, user_metadata: { bot: true, api_key_prefix: gen.prefix } });
  const botId = created.data.user?.id;
  if (created.error || !botId) throw new DbError("error", "error", { detail: "bot user" });
  const undo = async () => { await admin(svc).auth.admin.deleteUser(botId).then(undefined, () => undefined); };
  try {
    const role = await from(svc, "roles").select("id").is("tenant_id", null).eq("key", i.role).eq("is_system", true).maybeSingle();
    throwIfError(role.error);
    const roleId = (role.data as { id: string } | null)?.id ?? null;
    if (!roleId) throw new DbError("invalid", "invalid", { detail: "unknown role" });
    const prof = await from(svc, "profiles").insert({ id: botId, tenant_id: i.tenantId, full_name: `API key: ${i.name}`.slice(0, 120), email: `api-${nonce}@bots.synthan.invalid`, role: i.role, is_active: true });
    throwIfError(prof.error);
    const mem = await from(svc, "memberships").insert({ user_id: botId, workspace_id: i.workspaceId, tenant_id: i.tenantId, role: i.role, role_id: roleId, is_active: true, invited_by: i.createdBy });
    throwIfError(mem.error);
    const ins = await from(svc, "api_keys").insert({
      tenant_id: i.tenantId, workspace_id: i.workspaceId, name: i.name, prefix: gen.prefix, key_hash: gen.hash, env: i.env, scopes: i.scopes, role_id: roleId,
      bot_user_id: botId, created_by: i.createdBy, expires_at: i.expiresAt,
    }).select(PUBLIC_KEY_COLUMNS).single();
    throwIfError(ins.error);
    return { secret: gen.key, key: stripHash(rowToKey(ins.data as Record<string, unknown>)) };
  } catch (e) {
    await undo();
    throw e;
  }
}

const stripHash = (k: ReturnType<typeof rowToKey>): PublicKey => { const { keyHash: _h, ...rest } = k; void _h; return rest; };

/** New secret for the same key row: the old secret stops working immediately. */
export async function rotateApiKey(workspaceId: string, id: string, svc: Db = serviceDb()): Promise<CreatedKey> {
  const cur = await from(svc, "api_keys").select(PUBLIC_KEY_COLUMNS).eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
  throwIfError(cur.error);
  if (!cur.data) throw new DbError("not_found", "not_found");
  const k = rowToKey(cur.data as Record<string, unknown>);
  if (k.revokedAt) throw new DbError("invalid", "invalid", { detail: "revoked" });
  const gen = generateKey(k.env);
  const up = await from(svc, "api_keys").update({ prefix: gen.prefix, key_hash: gen.hash, last_used_at: null }).eq("workspace_id", workspaceId).eq("id", id).select(PUBLIC_KEY_COLUMNS).single();
  throwIfError(up.error);
  return { secret: gen.key, key: stripHash(rowToKey(up.data as Record<string, unknown>)) };
}

/** Revoke: the key stops authenticating at once and its bot user loses workspace access. */
export async function revokeApiKey(workspaceId: string, id: string, svc: Db = serviceDb(), now = new Date()): Promise<void> {
  const cur = await from(svc, "api_keys").select("id,bot_user_id,revoked_at").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
  throwIfError(cur.error);
  if (!cur.data) throw new DbError("not_found", "not_found");
  const row = cur.data as { bot_user_id: string | null; revoked_at: string | null };
  if (row.revoked_at) return;
  const up = await from(svc, "api_keys").update({ revoked_at: now.toISOString() }).eq("workspace_id", workspaceId).eq("id", id);
  throwIfError(up.error);
  if (row.bot_user_id) {
    const m = await from(svc, "memberships").update({ is_active: false }).eq("user_id", row.bot_user_id).eq("workspace_id", workspaceId);
    throwIfError(m.error);
  }
}

/** Listing for the screen: explicit public columns only (key_hash is never selected). */
export async function listApiKeys(db: Db, workspaceId: string): Promise<PublicKey[]> {
  const r = await from(db, "api_keys").select(PUBLIC_KEY_COLUMNS).eq("workspace_id", workspaceId).order("created_at", { ascending: false });
  throwIfError(r.error);
  return ((r.data as Record<string, unknown>[] | null) ?? []).map((x) => stripHash(rowToKey(x)));
}
