// Upserter: dedupe through external_links (exact), then match keys (E.164 phone, lower(email)); applies the tenant field map.
// Re-delivering the same external record with the same content is a no-op (idempotent), a changed one updates the same local row.
import { createHash } from "node:crypto";
import { applyFieldMap, effectiveMap } from "./field-map";
import type { ConnectorStore } from "./ports";
import { TARGET_TABLE } from "./ports";
import type { ConnectionRow, FieldMapSpec, Logger, UpsertTarget, Upserter } from "./types";

const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as object).sort(([a], [b]) => a.localeCompare(b))) : x));
export const contentHash = (v: unknown) => createHash("sha256").update(stable(v)).digest("hex");

export interface UpserterOpts { store: ConnectorStore; conn: ConnectionRow; defaults: FieldMapSpec[]; tenantMap: FieldMapSpec[]; log: Logger; onFieldReject?: (reason: string) => void }

export function makeUpserter(o: UpserterOpts): Upserter {
  const map = effectiveMap(o.defaults, o.tenantMap);
  return {
    async record(target: UpsertTarget, externalObject, externalId, data) {
      if (target.startsWith("obj:")) throw new Error(`Custom object targets are not supported by the framework yet (${target})`);
      const table = TARGET_TABLE[target as keyof typeof TARGET_TABLE];
      const mapped = applyFieldMap(map, externalObject, data, "in");
      for (const r of mapped.rejected) o.onFieldReject?.(`${r.reason}:${r.field}`);
      const row = mapped.byTable[table] ?? {};
      const hash = contentHash(row);
      const link = await o.store.getLink(o.conn.id, externalObject, externalId);
      if (link) {
        if (link.contentHash === hash) return { localId: link.localId, created: false };
        await o.store.updateLocal(table, link.localId, row);
        await o.store.touchLink(link.id, hash);
        return { localId: link.localId, created: false };
      }
      let localId: string | null = null;
      if (table === "leads" || table === "contacts") {
        localId = await o.store.findByMatchKey(table, o.conn.workspaceId, { phone: row.phone as string | undefined, email: row.email as string | undefined });
        if (localId) await o.store.updateLocal(table, localId, row);
      }
      const created = localId === null;
      if (created) localId = await o.store.insertLocal(table, { ...row, tenant_id: o.conn.tenantId, workspace_id: o.conn.workspaceId });
      await o.store.putLink({ tenantId: o.conn.tenantId, workspaceId: o.conn.workspaceId, connectionId: o.conn.id, externalObject, externalId, localTable: table, localId: localId as string, contentHash: hash, direction: "in" });
      return { localId: localId as string, created };
    },
  };
}
