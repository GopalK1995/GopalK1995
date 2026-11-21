// Saving per-connection sync options (integrations.settings). Server-action target for both CRM connectors: validates, writes, audits.
// Audit first: a change that cannot be audited does not happen.
import type { RuntimeDeps } from "../../core/ports";
import { CRM_OBJECTS, isCrmObject, optionsOf, type CrmStore, type SyncOptions } from "./types";

export type OptionsFail = "not_found" | "wrong_connector" | "invalid_input" | "audit_failed";
export type OptionsResult = { ok: true; options: SyncOptions } | { ok: false; code: OptionsFail; field?: string };

export interface OptionsInput { objects?: unknown; pushNew?: unknown; importMode?: unknown; importSince?: unknown; contactTarget?: unknown }

export async function saveSyncOptions(d: RuntimeDeps, crm: CrmStore, connectorId: string, connectionId: string, input: OptionsInput): Promise<OptionsResult> {
  const conn = await d.store.getConnection(connectionId);
  if (!conn) return { ok: false, code: "not_found" };
  if (conn.connectorId !== connectorId) return { ok: false, code: "wrong_connector" };
  const patch: Record<string, unknown> = {};
  if (input.objects !== undefined) {
    if (!Array.isArray(input.objects) || !input.objects.length || !input.objects.every(isCrmObject)) return { ok: false, code: "invalid_input", field: "objects" };
    patch.sync_objects = CRM_OBJECTS.filter((o) => (input.objects as string[]).includes(o));
  }
  if (input.pushNew !== undefined) { if (typeof input.pushNew !== "boolean") return { ok: false, code: "invalid_input", field: "pushNew" }; patch.push_new = input.pushNew; }
  if (input.importMode !== undefined) { if (input.importMode !== "skip" && input.importMode !== "merge") return { ok: false, code: "invalid_input", field: "importMode" }; patch.import_mode = input.importMode; }
  if (input.contactTarget !== undefined) { if (input.contactTarget !== "lead" && input.contactTarget !== "contact") return { ok: false, code: "invalid_input", field: "contactTarget" }; patch.contact_target = input.contactTarget; }
  if (input.importSince !== undefined) {
    if (input.importSince === null || input.importSince === "") patch.import_since = null;
    else if (typeof input.importSince === "string" && !Number.isNaN(Date.parse(input.importSince))) patch.import_since = new Date(input.importSince).toISOString();
    else return { ok: false, code: "invalid_input", field: "importSince" };
  }
  if (d.audit) {
    try { await d.audit({ action: "crm_sync.options_changed", summary: `Changed sync options for ${connectorId}`, connectionId, detail: { fields: Object.keys(patch), connector: connectorId } }); }
    catch { return { ok: false, code: "audit_failed" }; }
  }
  await crm.updateSettings(connectionId, patch);
  return { ok: true, options: optionsOf({ ...conn.settings, ...patch }) };
}
