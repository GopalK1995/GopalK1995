// Service-role Vault adapter over the public.vault_* wrappers (0015; private.put_secret/get_secret behind them).
// Server only. The wrappers are executable by service_role alone, so a user client can never read a secret.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import type { VaultPort } from "./ports";

type Rpc = { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }> };

export function supabaseVault(db: unknown = serviceDb()): VaultPort {
  const rpc = db as Rpc;
  return {
    async putSecret(name, value) {
      const { data, error } = await rpc.rpc("vault_put_secret", { p_name: name, p_secret: value, p_desc: "connector credentials" });
      if (error || typeof data !== "string") throw new Error("Vault write failed");   // never echo error detail: it may quote the call
      return data;
    },
    async getSecret(id) {
      const { data, error } = await rpc.rpc("vault_get_secret", { p_id: id });
      if (error) throw new Error("Vault read failed");
      return typeof data === "string" ? data : null;
    },
    async deleteSecret(id) {
      const { error } = await rpc.rpc("vault_delete_secret", { p_id: id });
      if (error) throw new Error("Vault delete failed");
    },
  };
}
