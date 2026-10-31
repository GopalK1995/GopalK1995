// Connector registry (CONTRACTS C9). Each vendor connector exports a ConnectorDef and registers it via src/lib/connectors/all.ts
// (integrator-owned). The mock connector is built in. Pure: no server-only imports.
import { mockConnector } from "./core/mock";
import type { ConnectorDef } from "./core/types";

const defs = new Map<string, ConnectorDef>();

export function registerConnector(def: ConnectorDef): void {
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(def.id)) throw new Error(`registerConnector: bad id "${def.id}"`);
  defs.set(def.id, def);
}
export function getConnector(id: string): ConnectorDef | undefined { return defs.get(id); }
export function listConnectors(): ConnectorDef[] { return [...defs.values()].sort((a, b) => a.name.localeCompare(b.name)); }
/** Test helper. Re-registers the built-ins. */
export function resetRegistry(): void { defs.clear(); registerConnector(mockConnector); }

/** The mock connector exists for tests and staging demos; production never lists or runs it. */
export function isUsableIn(def: ConnectorDef, appEnv: string): boolean { return def.id !== "mock" || appEnv !== "production"; }

type Env = Record<string, string | undefined>;
/** True when every env var the connector needs is set (client id/secret, partner key). OAuth connectors need their client pair. */
export function envConfigured(def: ConnectorDef, env: Env): boolean {
  const need = [...(def.requiredEnv ?? []), ...(def.oauth ? [def.oauth.clientIdEnv, def.oauth.clientSecretEnv] : [])];
  return need.every((k) => (env[k] ?? "").trim() !== "");
}
export function apiBaseFor(def: ConnectorDef, env: Env): string {
  return (def.apiBaseEnv && env[def.apiBaseEnv]?.trim()) || def.defaultApiBase || "";
}

registerConnector(mockConnector);
