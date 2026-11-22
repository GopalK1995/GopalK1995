// Onboarding wizard model. Pure data, no imports from next or react, so scripts and tests can use it.
export const STEP_IDS = ["template", "branding", "modules", "pipelines", "fields", "team", "integration", "import"] as const;
export type StepId = (typeof STEP_IDS)[number];
export type StepStatus = "todo" | "done" | "skipped";
export type KitId = "legal" | "hospitality" | "blank";

export interface StepRecord { status: StepStatus; at: string }
export interface OnboardingState {
  v: 1;
  /** Starter kit chosen in step 1. Decides which starter pipeline stages and fields the later steps offer. */
  kit: KitId | null;
  steps: Partial<Record<StepId, StepRecord>>;
  startedAt: string | null;
  completedAt: string | null;
}
export interface StepDef {
  id: StepId;
  /** Optional steps never block "finish". */
  optional: boolean;
  /** Permission key the step's writes need (same key the server action asserts). */
  perm: string;
  /** Where the full version of this step lives after setup. */
  home: string;
}
