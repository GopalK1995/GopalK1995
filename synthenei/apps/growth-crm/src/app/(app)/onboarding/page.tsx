import { requireActive } from "@/lib/auth/server";
import { getEffectiveConfig } from "@/lib/config/resolve";
import { brandDefaults } from "@/lib/config/resolve-pure";
import { moduleLocks } from "@/lib/config/permissions";
import { presetConfig } from "@/lib/config/presets";
import { MODULE_KEYS } from "@/lib/vertical";
import { SYSTEM_ROLES } from "@/lib/authz/catalog/system-roles";
import { PageHeader } from "@/components/ui/misc";
import { getOnboardingState } from "./actions";
import { STEPS } from "./_lib/steps";
import { resumeStep, statusOf as stepStatus } from "./_lib/progress";
import type { StepId } from "./_lib/types";
import { WizardShell } from "./_components/wizard-shell";

export const metadata = { title: "Set up your workspace" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const { session, active } = await requireActive();
  const demo = session.demo === true;
  const tenantId = active.tenant.id;
  const [state, cfg] = await Promise.all([getOnboardingState(), getEffectiveConfig(tenantId)]);
  const brand = brandDefaults(tenantId);
  const preset = presetConfig(cfg.preset, brand);
  const locks = moduleLocks(cfg, brand);
  const canBrand = active.tenant.primaryOwnerId === session.uid; // matches lib/config/permissions.ts: only the primary owner can change branding
  const roleOptions = SYSTEM_ROLES.filter((r) => r.baseRole !== "owner").map((r) => ({ id: r.id, name: r.name }));
  const statusMap = Object.fromEntries(STEPS.map((d) => [d.id, stepStatus(state, d.id)])) as Record<StepId, "todo" | "done" | "skipped">;

  return (
    <>
      <PageHeader eyebrow="Getting started" title="Set up your workspace" sub="A few steps to make the workspace yours -- skip anything optional and come back to it later." />
      <WizardShell
        demo={demo} steps={STEPS} resumeStep={resumeStep(state)} statusOf={statusMap}
        current={{ preset: cfg.preset, brandName: cfg.branding?.name ?? brand.name, product: cfg.branding?.product ?? brand.product, hue: cfg.branding?.hue ?? brand.hue, heading: cfg.branding?.fonts?.heading ?? "default", body: cfg.branding?.fonts?.body ?? "default" }}
        modules={MODULE_KEYS.map((k) => ({ key: k, enabled: cfg.modules[k] !== false, locked: locks[k] ?? null, defaultOn: preset.modules[k] !== false }))}
        roleOptions={roleOptions} canBrand={canBrand}
      />
    </>
  );
}
