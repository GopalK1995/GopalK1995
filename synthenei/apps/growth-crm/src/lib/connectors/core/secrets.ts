// Credential bundle handling on top of a VaultPort. One Vault secret per connection holds the JSON bundle
// (access/refresh token, api key...). The id of that secret is the only thing stored in integrations.credential_secret_id.
import type { ConnectionRow, ConnectionSecrets } from "./types";
import type { VaultPort } from "./ports";

export const secretName = (connectionId: string, key: "credentials" | "webhook") => `conn:${connectionId}:${key}`;

/** Stores a new bundle and, only after that succeeded, removes the previous one (a failure never leaves the connection without credentials). */
export async function saveSecrets(vault: VaultPort, connectionId: string, secrets: ConnectionSecrets, previousId: string | null, key: "credentials" | "webhook" = "credentials"): Promise<string> {
  const id = await vault.putSecret(`${secretName(connectionId, key)}:${Date.now().toString(36)}`, JSON.stringify(secrets));
  if (previousId && previousId !== id) await vault.deleteSecret(previousId).catch(() => undefined);
  return id;
}
export async function loadSecrets(vault: VaultPort, conn: Pick<ConnectionRow, "credentialSecretId">): Promise<ConnectionSecrets> {
  if (!conn.credentialSecretId) return {};
  const raw = await vault.getSecret(conn.credentialSecretId);
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "string")) as ConnectionSecrets;
  } catch { /* fall through */ }
  return {};
}
export async function dropSecrets(vault: VaultPort, conn: Pick<ConnectionRow, "credentialSecretId" | "webhookSecretId">): Promise<void> {
  for (const id of [conn.credentialSecretId, conn.webhookSecretId]) if (id) await vault.deleteSecret(id).catch(() => undefined);
}
