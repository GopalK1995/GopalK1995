// Settings -> Configuration (server component): resolves the effective config, the viewer's per-section access
// and the history, then hands plain data to the client editor. Writes go through ./config-actions.
import { requireActive } from "@/lib/auth/server";
import { getEffectiveConfig, getStore, getStored } from "@/lib/config/resolve";
import { brandDefaults } from "@/lib/config/resolve-pure";
import { moduleLocks, sectionAccess, SECTION_LABEL, type Actor } from "@/lib/config/permissions";
import { presetConfig } from "@/lib/config/presets";
import { historyFor } from "@/lib/config/apply";
import { ConfigEditor } from "./config-editor";
import { resetConfig, rollbackConfig, saveConfig } from "./config-actions";

export async function ConfigTab() {
  const { session, active } = await requireActive();
  const t = active.tenant.id;
  const [cfg, stored, store, hist] = await Promise.all([getEffectiveConfig(t), getStored(t), getStore(), historyFor(t)]);
  const actor: Actor = { kind: "org", uid: session.uid, name: session.name, role: active.role, tenantId: t, isPrimaryOwner: active.tenant.primaryOwnerId === session.uid, support: active.support ? { mode: active.support.mode } : null };
  const brand = brandDefaults(t);
  return (
    <ConfigEditor scope="org" tenantId={t} base={cfg} preset={presetConfig(cfg.preset, brand)} savedCopy={store.savedCopy} version={stored.version}
      access={sectionAccess(actor, t)} moduleLocks={moduleLocks(cfg, brand)}
      history={hist.map((h) => ({ version: h.version, at: h.at, by: h.by, actor: h.actorLabel, reason: h.reason, summary: h.sections.length ? h.sections.map((s) => SECTION_LABEL[s]).join(", ") : "Configuration saved" }))}
      actions={{ save: saveConfig, reset: resetConfig, rollback: rollbackConfig }} />
  );
}
