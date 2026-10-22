// ConfigStore: where a tenant's OVERRIDES live. Server only.
//  * CookieConfigStore   demo/mock sessions: signed httpOnly cookie per tenant (overrides only, size-guarded);
//                        history is kept in-process (resets on restart; labelled as such in the UI).
//  * SupabaseConfigStore real sessions: tenant_config via the user's own client (RLS), platform admins through
//                        the audited RPC admin_set_tenant_config(). History is written by a DB trigger.
// Stores never decide permissions; callers run authorize() first.
import { cookies } from "next/headers";
import { cookieOpts } from "../auth/cookies";
import { createSupabaseServerClient } from "../supabase/server";
import type { Actor } from "./permissions";
import { CFG_COOKIE_MAX_AGE, cfgCookieName, decodeCfgCookie, encodeCfgCookie } from "./cookie-codec";
import { CONFIG_VERSION, validateOverrides, type ConfigOverrides, type Section } from "./types";

export interface StoredConfig { version: number; overrides: ConfigOverrides; updatedAt: string | null; updatedBy: string | null }
export interface HistoryEntry { version: number; at: string; by: string; actorLabel: string; reason?: string; sections: Section[]; overrides: ConfigOverrides }
export interface WriteMeta { actor: Actor; reason?: string; sections: Section[]; expectedVersion?: number }
export type WriteResult = { ok: true; version: number } | { ok: false; message: string };
export interface ConfigStore {
  readonly mode: "browser" | "workspace";
  /** Copy shown next to Save. */
  readonly savedCopy: string;
  read(tenantId: string): Promise<StoredConfig>;
  write(tenantId: string, overrides: ConfigOverrides, meta: WriteMeta): Promise<WriteResult>;
  history(tenantId: string): Promise<HistoryEntry[]>;
}
export const SAVED_COPY = { browser: "Saved in this browser (demo)", workspace: "Saved to your workspace" } as const;
const EMPTY: StoredConfig = { version: 0, overrides: { v: CONFIG_VERSION }, updatedAt: null, updatedBy: null };

const g = globalThis as unknown as { __gcrmCfgHistory?: Map<string, HistoryEntry[]> };
const memHistory = () => (g.__gcrmCfgHistory ??= new Map());

export class CookieConfigStore implements ConfigStore {
  readonly mode = "browser" as const;
  readonly savedCopy = SAVED_COPY.browser;
  async read(tenantId: string): Promise<StoredConfig> {
    const p = await decodeCfgCookie(tenantId, (await cookies()).get(cfgCookieName(tenantId))?.value);
    return p ? { version: p.ver, overrides: p.ovr, updatedAt: p.at, updatedBy: p.by } : EMPTY;
  }
  async write(tenantId: string, overrides: ConfigOverrides, meta: WriteMeta): Promise<WriteResult> {
    const cur = await this.read(tenantId);
    if (meta.expectedVersion !== undefined && meta.expectedVersion !== cur.version) return { ok: false, message: "The configuration changed since you opened it. Reload and try again." };
    const version = cur.version + 1, at = new Date().toISOString();
    const enc = await encodeCfgCookie({ t: tenantId, ver: version, at, by: meta.actor.name, ovr: { ...overrides, v: CONFIG_VERSION } });
    if (!enc.ok) return { ok: false, message: enc.message };
    (await cookies()).set(cfgCookieName(tenantId), enc.value, cookieOpts(CFG_COOKIE_MAX_AGE));
    const h = memHistory().get(tenantId) ?? [];
    h.unshift({ version, at, by: meta.actor.name, actorLabel: meta.actor.kind === "platform" ? "platform_admin" : "owner", reason: meta.reason, sections: meta.sections, overrides });
    memHistory().set(tenantId, h.slice(0, 30));
    return { ok: true, version };
  }
  async history(tenantId: string) { return memHistory().get(tenantId) ?? []; }
}

type CfgRow = { tenant_id: string; version: number; config: unknown; updated_at: string | null; updated_by: string | null } | null;
export class SupabaseConfigStore implements ConfigStore {
  readonly mode = "workspace" as const;
  readonly savedCopy = SAVED_COPY.workspace;
  private async client() {
    const sb = await createSupabaseServerClient();
    if (!sb) throw new Error("Supabase is not configured");
    return sb;
  }
  private async row(tenantId: string): Promise<CfgRow> {
    const { data, error } = await (await this.client()).rpc("get_tenant_config", { p_tenant: tenantId });
    if (error) throw new Error(error.message);
    return (data as CfgRow) ?? null;
  }
  async read(tenantId: string): Promise<StoredConfig> {
    const r = await this.row(tenantId);
    if (!r || r.version === 0) return EMPTY;
    return { version: r.version, overrides: validateOverrides(r.config, { strict: false }).value, updatedAt: r.updated_at, updatedBy: r.updated_by };
  }
  async write(tenantId: string, overrides: ConfigOverrides, meta: WriteMeta): Promise<WriteResult> {
    const sb = await this.client();
    const config = { ...overrides, v: CONFIG_VERSION };
    if (meta.actor.kind === "platform") {
      const { data, error } = await sb.rpc("admin_set_tenant_config", { p_tenant: tenantId, p_config: config, p_reason: meta.reason ?? "" });
      return error ? { ok: false, message: error.message } : { ok: true, version: Number(data) };
    }
    const r = await this.row(tenantId);
    if (!r) return { ok: false, message: "Unknown tenant." };
    if (r.version === 0) {
      const { error } = await sb.from("tenant_config").insert({ tenant_id: r.tenant_id, config });
      return error ? { ok: false, message: error.message } : { ok: true, version: 1 };
    }
    if (meta.expectedVersion !== undefined && meta.expectedVersion !== r.version) return { ok: false, message: "The configuration changed since you opened it. Reload and try again." };
    const { data, error } = await sb.from("tenant_config").update({ config }).eq("tenant_id", r.tenant_id).eq("version", r.version).select("version");
    if (error) return { ok: false, message: error.message };
    if (!data?.length) return { ok: false, message: "The configuration changed while saving. Reload and try again." };
    return { ok: true, version: data[0].version as number };
  }
  async history(tenantId: string): Promise<HistoryEntry[]> {
    const { data, error } = await (await this.client()).rpc("get_tenant_config_history", { p_tenant: tenantId, p_limit: 30 });
    if (error) return [];
    return ((data as { version: number; config: unknown; actor_label: string; reason: string | null; created_at: string; changed_by: string | null }[]) ?? []).map((h) => ({
      version: h.version, at: h.created_at, by: h.changed_by ?? "service", actorLabel: h.actor_label, reason: h.reason ?? undefined, sections: [], overrides: validateOverrides(h.config, { strict: false }).value,
    }));
  }
}
