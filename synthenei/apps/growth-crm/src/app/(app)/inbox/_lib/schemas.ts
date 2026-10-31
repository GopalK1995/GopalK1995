import { z } from "zod";

const id = z.string().min(1).max(64);
export const version = z.number().int().min(0);
const body = z.string().trim().min(1).max(4000);

export const sendSchema = z.object({
  convId: id,
  kind: z.enum(["reply", "template", "note"]),
  body: z.string().max(4000).default(""),
  templateId: id.optional(),
  /** values for {{1}}, {{2}} in the template body */
  vars: z.array(z.string().trim().max(120)).max(8).default([]),
});
export type SendInput = z.input<typeof sendSchema>;

export const noteSchema = z.object({ convId: id, body });
export const statusSchema = z.object({ convId: id, status: z.enum(["open", "snoozed", "closed"]), expectedVersion: version });
export const assignSchema = z.object({ convId: id, assigneeId: id, expectedVersion: version });
export const linkSchema = z.object({ convId: id, leadId: id, expectedVersion: version });
export const readSchema = z.object({ convId: id, expectedVersion: version.optional() });
