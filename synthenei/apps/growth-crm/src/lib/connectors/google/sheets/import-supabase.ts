// Supabase implementation of SheetsImportPort on the SERVICE-ROLE client (scheduled stream), reusing the T034 engine unchanged.
// Every read and write is scoped by workspace_id and tenant_id inside the engine. Server only.
import "server-only";
import type { Db } from "@/lib/db/client";
import { BASE } from "@/i18n/registry";
import { loadExistingIndex, writePlan } from "@/lib/import/engine";
import { targetsFor } from "@/lib/import/targets";
import { getObjectType, listFields } from "@/lib/metadata/repo";
import type { SheetsImportPort } from "./import";

const fieldLabels = (): Record<string, string> => ((BASE.en.imports as { fields?: Record<string, string> } | undefined)?.fields ?? {});

export function supabaseImportPort(db: Db): SheetsImportPort {
  return {
    async targets({ tenantId, object }) {
      const ot = await getObjectType(tenantId, object, async () => db);
      const defs = ot ? await listFields(ot.id, {}, async () => db) : [];
      const labels = fieldLabels();
      return targetsFor(object, (k) => labels[k] ?? k, defs);
    },
    loadExisting: (workspaceId, object) => loadExistingIndex(db, workspaceId, object),
    write: (rows, o) => writePlan(rows, { db, ws: o.workspaceId, tenantId: o.tenantId, object: o.object, mode: o.mode, source: o.source }),
  };
}
