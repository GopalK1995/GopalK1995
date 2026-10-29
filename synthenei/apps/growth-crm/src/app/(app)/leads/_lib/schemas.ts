// Input schemas for every lead write (zod). Pure: shared by server actions and unit tests.
import { z } from "zod";
import { CALL_OUTCOMES } from "./sales";

export const LEAD_STATUSES = ["new", "contacted", "qualified", "nurturing", "disqualified", "converted"] as const;
export const DISQUALIFY_REASONS = ["student", "not_a_firm", "outside_tn", "duplicate", "no_budget", "competitor", "spam", "travel_agent_cold", "outside_area", "budget"] as const;

const text = (max: number) => z.string().trim().max(max);
const uuid = z.string().uuid();
export const version = z.number().int().min(1);
const phone = text(20).refine((p) => p === "" || /^(\+?91)?[6-9]\d{9}$/.test(p.replace(/[\s-]/g, "")), "Enter a 10 digit Indian mobile number");
const email = text(200).refine((e) => e === "" || /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e), "Enter a valid email address");

export const createLeadSchema = z.object({
  fullName: text(120).min(1, "Name is required"),
  roleTitle: text(120).optional().default(""),
  firmName: text(160).optional().default(""),
  email: email.optional().default(""),
  phone: phone.optional().default(""),
  city: text(80).optional().default(""),
  ownerId: uuid.nullable().optional(),
}).refine((v) => v.email !== "" || v.phone !== "", { path: ["email"], message: "Add a phone number or an email" });
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = z.object({
  expectedVersion: version,
  patch: z.object({
    fullName: text(120).min(1),
    roleTitle: text(120),
    firmName: text(160),
    email,
    phone,
    city: text(80),
  }).partial().refine((p) => Object.keys(p).length > 0, "Nothing to change"),
});
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const assignSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500), ownerId: z.string().min(1) });

export const statusSchema = z.object({
  status: z.enum(LEAD_STATUSES),
  reason: z.enum(DISQUALIFY_REASONS).optional(),
  expectedVersion: version.optional(),
}).refine((v) => v.status !== "disqualified" || !!v.reason, { path: ["reason"], message: "Disqualifying needs a reason." });

export const callSchema = z.object({
  outcome: z.enum(CALL_OUTCOMES.map((o) => o.key) as [string, ...string[]]),
  minutes: z.number().min(0).max(240),
  notes: text(2000).default(""),
  nextDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(""),
});

export const emailSchema = z.object({ subject: text(200).min(1, "Add a subject") });

export const demoSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Pick a time"),
  minutes: z.number().int().min(15).max(180),
  mode: text(60).min(1),
});

export const suggestionAcceptSchema = z.object({ action: text(200).min(1), due: text(40).min(1) });
export const suggestionDismissSchema = z.object({ reason: text(120).min(1) });
