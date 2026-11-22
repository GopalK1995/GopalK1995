import { describe, expect, it } from "vitest";
import { blockers, canFinish, counts, emptyState, finish, markStep, needsSetup, parseState, resumeStep, setKit, statusOf } from "../progress";
import { STEPS } from "../steps";
import type { OnboardingState } from "../types";

const NOW = new Date("2026-06-15T00:00:00.000Z");

describe("emptyState / parseState", () => {
  it("empty state has every step unanswered and needs setup", () => {
    const s = emptyState();
    expect(s).toEqual({ v: 1, kit: null, steps: {}, startedAt: null, completedAt: null });
    expect(needsSetup(s)).toBe(true);
  });
  it("parses a well-formed cookie/jsonb payload back exactly", () => {
    const raw = { v: 1, kit: "legal", steps: { template: { status: "done", at: "2026-06-01T00:00:00.000Z" } }, startedAt: "2026-06-01T00:00:00.000Z", completedAt: null };
    expect(parseState(raw)).toEqual(raw);
  });
  it("never trusts unknown step ids, bad statuses, or a bad kit", () => {
    const raw = { kit: "enterprise", steps: { template: { status: "done", at: "x" }, bogus: { status: "done", at: "x" }, branding: { status: "whenever", at: "x" } } };
    const s = parseState(raw);
    expect(s.kit).toBeNull();
    expect(s.steps).toEqual({ template: { status: "done", at: "x" } });
  });
  it("garbage input (null, a string, an array) is the empty state, not a throw", () => {
    expect(parseState(null)).toEqual(emptyState());
    expect(parseState("not an object")).toEqual(emptyState());
    expect(parseState([1, 2, 3])).toEqual(emptyState());
  });
});

describe("markStep / setKit", () => {
  it("marking the first step sets startedAt once, and never moves it on later steps", () => {
    let s = markStep(emptyState(), "template", "done", NOW);
    expect(s.startedAt).toBe(NOW.toISOString());
    const later = new Date("2026-06-16T00:00:00.000Z");
    s = markStep(s, "branding", "done", later);
    expect(s.startedAt).toBe(NOW.toISOString()); // unchanged
    expect(s.steps.branding).toEqual({ status: "done", at: later.toISOString() });
  });
  it("re-marking a step overwrites its status and timestamp", () => {
    let s = markStep(emptyState(), "integration", "skipped", NOW);
    expect(statusOf(s, "integration")).toBe("skipped");
    s = markStep(s, "integration", "done", NOW);
    expect(statusOf(s, "integration")).toBe("done");
  });
  it("setKit records the kit and starts the clock like markStep does", () => {
    const s = setKit(emptyState(), "hospitality", NOW);
    expect(s.kit).toBe("hospitality");
    expect(s.startedAt).toBe(NOW.toISOString());
  });
});

describe("resumeStep / counts / blockers / canFinish / finish", () => {
  const withDone = (...ids: string[]) => ids.reduce((s, id) => markStep(s, id as never, "done", NOW), emptyState());

  it("resumeStep is the first step still todo, in STEPS order, and null once every step has an answer", () => {
    expect(resumeStep(emptyState())).toBe(STEPS[0].id);
    const s = withDone(...STEPS.slice(0, 3).map((d) => d.id));
    expect(resumeStep(s)).toBe(STEPS[3].id);
    const everything = STEPS.reduce((acc, d) => markStep(acc, d.id, d.optional ? "skipped" : "done", NOW), emptyState());
    expect(resumeStep(everything)).toBeNull();
  });

  it("counts partitions every step into done, skipped or todo, and they always sum to the total", () => {
    const s = markStep(markStep(emptyState(), "template", "done", NOW), "integration", "skipped", NOW);
    const c = counts(s);
    expect(c.total).toBe(STEPS.length);
    expect(c.done + c.skipped + c.todo).toBe(c.total);
    expect(c).toMatchObject({ done: 1, skipped: 1 });
  });

  it("blockers lists only required steps that are not done; optional steps never block", () => {
    const requiredIds = STEPS.filter((d) => !d.optional).map((d) => d.id);
    expect(blockers(emptyState())).toEqual(requiredIds);
    const oneRequiredDone = markStep(emptyState(), requiredIds[0], "done", NOW);
    expect(blockers(oneRequiredDone)).toEqual(requiredIds.slice(1));
    // Skipping an optional step never shows up as a blocker, even though it isn't "done".
    const optionalId = STEPS.find((d) => d.optional)!.id;
    const skippedOptional = markStep(emptyState(), optionalId, "skipped", NOW);
    expect(blockers(skippedOptional)).toEqual(requiredIds);
  });

  it("canFinish and finish agree: finish only sets completedAt once every required step is done", () => {
    const requiredIds = STEPS.filter((d) => !d.optional).map((d) => d.id);
    let s = emptyState();
    for (const id of requiredIds) {
      expect(canFinish(s)).toBe(false);
      expect(finish(s, NOW).completedAt).toBeNull(); // finish is a no-op while blocked
      s = markStep(s, id, "done", NOW);
    }
    expect(canFinish(s)).toBe(true);
    const done = finish(s, NOW);
    expect(done.completedAt).toBe(NOW.toISOString());
    expect(needsSetup(done)).toBe(false);
  });

  it("finish does not require optional steps to be done or even skipped", () => {
    const requiredIds = STEPS.filter((d) => !d.optional).map((d) => d.id);
    const s = requiredIds.reduce((acc, id) => markStep(acc, id, "done", NOW), emptyState());
    expect(canFinish(s)).toBe(true);
    expect(finish(s, NOW).completedAt).not.toBeNull();
  });
});

describe("statusOf", () => {
  it("defaults to todo for a step with no record", () => {
    expect(statusOf(emptyState(), "team")).toBe("todo");
  });
});
