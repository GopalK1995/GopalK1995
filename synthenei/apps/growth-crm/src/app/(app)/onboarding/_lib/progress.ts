// Pure progress model: nothing here reads a cookie or a table, so resume behaviour is unit-testable.
import { STEPS } from "./steps";
import { STEP_IDS, type KitId, type OnboardingState, type StepId, type StepStatus } from "./types";

export const emptyState = (): OnboardingState => ({ v: 1, kit: null, steps: {}, startedAt: null, completedAt: null });

const KITS: KitId[] = ["legal", "hospitality", "blank"];
/** Tolerant parse of whatever a cookie or a jsonb column holds. Unknown steps and statuses are dropped, never trusted. */
export function parseState(raw: unknown): OnboardingState {
  const base = emptyState();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const steps: OnboardingState["steps"] = {};
  const src = (r.steps && typeof r.steps === "object" ? r.steps : {}) as Record<string, { status?: unknown; at?: unknown }>;
  for (const id of STEP_IDS) {
    const s = src[id];
    if (s && (s.status === "done" || s.status === "skipped" || s.status === "todo")) steps[id] = { status: s.status, at: typeof s.at === "string" ? s.at : "" };
  }
  return {
    v: 1, steps,
    kit: KITS.includes(r.kit as KitId) ? (r.kit as KitId) : null,
    startedAt: typeof r.startedAt === "string" ? r.startedAt : null,
    completedAt: typeof r.completedAt === "string" ? r.completedAt : null,
  };
}

export const statusOf = (s: OnboardingState, id: StepId): StepStatus => s.steps[id]?.status ?? "todo";

export function markStep(s: OnboardingState, id: StepId, status: StepStatus, now = new Date()): OnboardingState {
  const at = now.toISOString();
  return { ...s, startedAt: s.startedAt ?? at, steps: { ...s.steps, [id]: { status, at } } };
}
export const setKit = (s: OnboardingState, kit: KitId, now = new Date()): OnboardingState => ({ ...s, kit, startedAt: s.startedAt ?? now.toISOString() });

/** The step to open on resume: first one still "todo", in order. null when every step has an answer. */
export function resumeStep(s: OnboardingState): StepId | null {
  return STEPS.find((d) => statusOf(s, d.id) === "todo")?.id ?? null;
}
export function counts(s: OnboardingState) {
  const done = STEPS.filter((d) => statusOf(s, d.id) === "done").length;
  const skipped = STEPS.filter((d) => statusOf(s, d.id) === "skipped").length;
  return { done, skipped, total: STEPS.length, todo: STEPS.length - done - skipped };
}
/** Finish is allowed when every required step is done. Optional steps may be skipped; required ones may not. */
export function blockers(s: OnboardingState): StepId[] {
  return STEPS.filter((d) => !d.optional && statusOf(s, d.id) !== "done").map((d) => d.id);
}
export const canFinish = (s: OnboardingState) => blockers(s).length === 0;
export function finish(s: OnboardingState, now = new Date()): OnboardingState {
  return canFinish(s) ? { ...s, completedAt: now.toISOString() } : s;
}
/** True while the owner still has setup to do (used by the shell to point at /onboarding). */
export const needsSetup = (s: OnboardingState) => s.completedAt === null;
