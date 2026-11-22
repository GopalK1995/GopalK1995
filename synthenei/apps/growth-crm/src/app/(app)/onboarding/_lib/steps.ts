import { STEP_IDS, type StepDef, type StepId } from "./types";

export const STEPS: StepDef[] = [
  { id: "template", optional: false, perm: "config.edit", home: "/settings" },
  { id: "branding", optional: false, perm: "org.branding", home: "/settings" },
  { id: "modules", optional: false, perm: "config.edit", home: "/settings" },
  { id: "pipelines", optional: false, perm: "pipelines.manage", home: "/settings/pipelines" },
  { id: "fields", optional: false, perm: "fields.manage", home: "/settings/fields" },
  { id: "team", optional: false, perm: "members.invite", home: "/settings" },
  { id: "integration", optional: true, perm: "integrations.manage", home: "/integrations" },
  { id: "import", optional: true, perm: "leads.import", home: "/import" },
];
export const stepDef = (id: StepId): StepDef => STEPS.find((s) => s.id === id)!;
export const isStepId = (x: unknown): x is StepId => typeof x === "string" && (STEP_IDS as readonly string[]).includes(x);
