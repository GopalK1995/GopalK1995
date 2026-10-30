// Input schemas for task writes (zod). Pure: shared by server actions and unit tests.
import { z } from "zod";

export const TASK_KINDS = ["call", "whatsapp", "email", "demo", "follow_up", "proposal"] as const;
export const PRIORITIES = ["high", "normal", "low"] as const;
const version = z.number().int().min(1);
const due = z.string().refine((s) => Number.isFinite(Date.parse(s)), "Pick a due date and time.");

export const createTaskSchema = z.object({
  title: z.string().trim().min(3, "Give the task a title (3 to 120 characters).").max(120, "Give the task a title (3 to 120 characters)."),
  kind: z.enum(TASK_KINDS, { message: "Pick a task type." }),
  due,
  leadId: z.string().uuid().or(z.literal("")).optional().default(""),
  priority: z.enum(PRIORITIES, { message: "Pick a priority." }),
  assigneeId: z.string().uuid().nullable().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const editTaskSchema = z.object({
  expectedVersion: version,
  patch: z.object({
    title: z.string().trim().min(3).max(120).optional(),
    kind: z.enum(TASK_KINDS).optional(),
    priority: z.enum(PRIORITIES).optional(),
    due: due.optional(),
  }).refine((p) => Object.keys(p).length > 0, "Nothing to change."),
});
export const rescheduleSchema = z.object({ expectedVersion: version, due });
export const reassignSchema = z.object({ expectedVersion: version, ownerId: z.string().uuid() });
export const idsSchema = z.array(z.string().uuid()).min(1).max(200);
