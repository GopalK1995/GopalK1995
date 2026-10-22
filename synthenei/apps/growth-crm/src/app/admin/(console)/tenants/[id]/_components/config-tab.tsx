// Admin -> Tenants -> <tenant> -> Configuration (server component). Same editors as Settings -> Configuration,
// plus Preset, tile catalogue and module locks (inside the editors), copy-from-tenant and create-from-template.
import { Copy, Layers, Plus } from "lucide-react";
import { getEffectiveConfig, getStore, getStored } from "@/lib/config/resolve";
import { brandDefaults } from "@/lib/config/resolve-pure";
import { moduleLocks, sectionAccess, MATRIX, SECTION_LABEL, type Actor } from "@/lib/config/permissions";
import { presetConfig } from "@/lib/config/presets";
import { historyFor } from "@/lib/config/apply";
import { SECTIONS } from "@/lib/config/types";
import { TENANTS } from "@/lib/tenancy";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionDialog } from "../../../../_components/action-dialog";
import { ConfigEditor } from "@/app/(app)/settings/_components/config-editor";
import { adminResetConfig, adminRollbackConfig, adminSaveConfig, copyConfigFrom, createTenantFromTemplate, setPreset } from "./config-actions";

const TEMPLATES = [{ value: "legal", label: "Legal (LAWSOME)" }, { value: "hospitality", label: "Guesthouse (Shola Mist)" }, { value: "blank", label: "Blank" }];
const MATRIX_COPY = { edit: "Edit", "edit-owner-primary": "Primary owner", limited: "Limited", no: "No" } as const;

export async function TenantConfigTab({ tenantId }: { tenantId: string }) {
  const [cfg, stored, store, hist] = await Promise.all([getEffectiveConfig(tenantId), getStored(tenantId), getStore(), historyFor(tenantId)]);
  const actor: Actor = { kind: "platform", uid: "platform", name: "platform" };
  const brand = brandDefaults(tenantId);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Preset and templates" sub="The preset is the starting template; a tenant's changes are stored as overrides on top of it."
          action={<Badge tone="navy">{cfg.preset}</Badge>} />
        <CardBody className="flex flex-wrap gap-2">
          <ActionDialog trigger="Change preset" icon={<Layers />} title={`Change preset for ${tenantId}`} submit="Change preset"
            description="Wording, stages, categories, modules, vertical features and dashboard tiles go back to the new preset's values. Branding, data settings and module locks are kept. The previous version stays in history and can be rolled back."
            fields={[
              { name: "tenant", label: "", type: "hidden", defaultValue: tenantId },
              { name: "preset", label: "New preset", type: "select", options: TEMPLATES, defaultValue: cfg.preset },
              { name: "reason", label: "Reason (audited)", placeholder: "e.g. Client moved from legal to guesthouse pilot" },
              { name: "confirm", label: `Type ${tenantId} to confirm`, mono: true, placeholder: tenantId },
            ]} action={setPreset} />
          <ActionDialog trigger="Copy config from tenant" icon={<Copy />} title={`Copy configuration into ${tenantId}`} submit="Copy configuration"
            description="Copies wording, stages, categories, modules, dashboard tiles and targets. Brand, sample-data switch and module locks are not copied."
            fields={[
              { name: "tenant", label: "", type: "hidden", defaultValue: tenantId },
              { name: "source", label: "Copy from", type: "select", options: TENANTS.filter((t) => t.id !== tenantId).map((t) => ({ value: t.id, label: t.name })) },
              { name: "reason", label: "Reason (audited)", placeholder: "e.g. Same setup as the guesthouse pilot" },
            ]} action={copyConfigFrom} />
          <ActionDialog trigger="Create tenant from template" icon={<Plus />} title="Create a tenant from a template" submit="Create tenant"
            description="Creates the tenant, its first workspace and an Owner invitation, then applies the template's wording, stages, categories and modules."
            fields={[
              { name: "template", label: "Template", type: "select", options: TEMPLATES, defaultValue: "hospitality" },
              { name: "name", label: "Tenant name", placeholder: "Nilgiri Stays" },
              { name: "slug", label: "Slug", mono: true, placeholder: "nilgiri-stays" },
              { name: "hue", label: "Accent hue (0-359)", type: "number", defaultValue: "152" },
              { name: "workspace", label: "First workspace", placeholder: "Ooty" },
              { name: "owner", label: "Owner email", type: "email", placeholder: "owner@client.example" },
              { name: "reason", label: "Reason (audited)", placeholder: "e.g. New pilot signed 22 Oct" },
            ]} action={createTenantFromTemplate} />
        </CardBody>
      </Card>

      <ConfigEditor scope="platform" tenantId={tenantId} base={cfg} preset={presetConfig(cfg.preset, brand)} savedCopy={store.savedCopy} version={stored.version}
        access={sectionAccess(actor, tenantId)} moduleLocks={moduleLocks(cfg, brand)}
        history={hist.map((h) => ({ version: h.version, at: h.at, by: h.by, actor: h.actorLabel, reason: h.reason, summary: h.sections.length ? h.sections.map((s) => SECTION_LABEL[s]).join(", ") : "Configuration saved" }))}
        actions={{ save: adminSaveConfig, reset: adminResetConfig, rollback: adminRollbackConfig }} />

      <Card>
        <CardHeader title="Who can change what" sub="Enforced on the server for every save, not only in this screen." />
        <CardBody>
          <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-left text-[13px]"><caption className="sr-only">Configuration permissions by role</caption>
            <thead><tr className="text-[12px] text-ink-3"><th className="py-1.5 pr-3 font-medium">Section</th><th className="py-1.5 pr-3 font-medium">Org admin (Owner)</th><th className="py-1.5 font-medium">Super admin</th></tr></thead>
            <tbody>{SECTIONS.map((s) => <tr key={s} className="border-t border-line"><td className="py-1.5 pr-3 text-ink">{SECTION_LABEL[s]}</td><td className="py-1.5 pr-3 text-ink-2">{MATRIX_COPY[MATRIX[s].org]}</td><td className="py-1.5 text-ink-2">Edit, with reason</td></tr>)}</tbody></table></div>
        </CardBody>
      </Card>
    </div>
  );
}
