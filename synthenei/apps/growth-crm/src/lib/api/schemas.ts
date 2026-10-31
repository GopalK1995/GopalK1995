// Request schemas (zod) for every writable resource. These are also the source of the OpenAPI document.
// Snake_case on the wire. Unknown keys are rejected so a typo never silently drops data.
import { z } from "zod";
import type { FieldSpec } from "./filters";

const id = z.string().uuid();
const custom = z.record(z.string().regex(/^[a-z][a-z0-9_]{1,40}$/), z.unknown()).optional();
const text = (max = 200) => z.string().trim().max(max);
const optText = (max = 200) => text(max).nullable().optional();
const optId = id.nullable().optional();
const optDate = z.string().datetime({ offset: true }).nullable().optional();

export const leadCreate = z.object({
  full_name: text(160).min(1), email: z.string().email().nullable().optional(), phone: optText(40), city: optText(), district: optText(), source: optText(80),
  status: optText(40), owner_id: optId, account_id: optId, contact_id: optId, campaign_id: optId, firm_name: optText(), practice_area: optText(), role_title: optText(),
  next_step_at: optDate, custom,
}).strict();
export const leadUpdate = leadCreate.partial().extend({ expected_version: z.number().int().positive().optional() }).strict();

export const contactCreate = z.object({
  full_name: text(160).min(1), email: z.string().email().nullable().optional(), phone: optText(40), role_title: optText(), account_id: optId, owner_id: optId,
  is_decision_maker: z.boolean().optional(), preferred_language: z.enum(["en", "ta"]).optional(), custom,
}).strict();
export const contactUpdate = contactCreate.partial().extend({ expected_version: z.number().int().positive().optional() }).strict();

export const accountCreate = z.object({
  name: text(200).min(1), city: optText(), district: optText(), state: optText(), website: optText(300), size_band: optText(40), address_line: optText(300),
  lawyers_count: z.number().int().nonnegative().nullable().optional(), clerks_count: z.number().int().nonnegative().nullable().optional(),
  customer_status: optText(40), owner_id: optId, custom,
}).strict();
export const accountUpdate = accountCreate.partial().extend({ expected_version: z.number().int().positive().optional() }).strict();

export const dealCreate = z.object({
  name: text(200).min(1), value_inr: z.number().nonnegative().optional(), stage_key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/).optional(), stage_id: id.optional(),
  account_id: optId, lead_id: optId, primary_contact_id: optId, owner_id: optId, next_step: optText(300), next_step_at: optDate, expected_close_on: z.string().date().nullable().optional(),
  plan: optText(80), seats: z.number().int().nonnegative().nullable().optional(), competitor: optText(), custom,
}).strict();
export const dealUpdate = dealCreate.omit({ stage_key: true, stage_id: true }).partial().extend({ lost_reason: optText(300), expected_version: z.number().int().positive().optional() }).strict();
export const dealMove = z.object({ stage_key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/), expected_version: z.number().int().positive(), lost_reason: optText(300) }).strict();

export const taskCreate = z.object({
  title: text(300).min(1), kind: text(40).optional(), due_at: z.string().datetime({ offset: true }), priority: z.number().int().min(0).max(3).optional(),
  status: optText(40).optional(), assignee_id: optId, lead_id: optId, deal_id: optId, custom,
}).strict();
export const taskUpdate = taskCreate.partial().extend({ expected_version: z.number().int().positive().optional() }).strict();

export const activityCreate = z.object({
  kind: text(40).min(1), subject: optText(300), body: z.string().max(10_000).nullable().optional(), lead_id: optId, contact_id: optId, account_id: optId, deal_id: optId,
  direction: z.enum(["in", "out", "inbound", "outbound"]).nullable().optional(), scheduled_at: optDate, done_at: optDate, duration_mins: z.number().int().nonnegative().nullable().optional(),
  outcome: optText(300), meeting_type: optText(80), owner_id: optId,
}).strict();

export const recordCreate = z.object({ title: text(300).optional(), custom: z.record(z.string(), z.unknown()).optional(), owner_id: optId }).strict();
export const recordUpdate = recordCreate.partial().extend({ expected_version: z.number().int().positive().optional() }).strict();

export const webhookCreate = z.object({ url: z.string().url().max(500), event_types: z.array(z.string().regex(/^[a-z_*]+(\.[a-z_*:]+)*$/)).min(1).max(50), description: optText(200) }).strict();

export const idParam = z.string().min(1).max(64);

const D: FieldSpec = { kind: "date" }, U: FieldSpec = { kind: "uuid" }, T: FieldSpec = { kind: "text" }, N: FieldSpec = { kind: "number" };
export const FILTERS: Record<string, Record<string, FieldSpec>> = {
  leads: { status: T, source: T, owner_id: U, district: T, city: T, campaign_id: U, account_id: U, email: T, full_name: T, created_at: D, updated_at: D, score: N },
  contacts: { full_name: T, email: T, account_id: U, owner_id: U, created_at: D, updated_at: D },
  accounts: { name: T, district: T, city: T, state: T, customer_status: T, owner_id: U, created_at: D, updated_at: D },
  deals: { stage_id: U, owner_id: U, account_id: U, lead_id: U, value_inr: N, expected_close_on: D, created_at: D, updated_at: D },
  tasks: { status: T, kind: T, assignee_id: U, lead_id: U, deal_id: U, due_at: D, created_at: D },
  activities: { kind: T, lead_id: U, contact_id: U, account_id: U, deal_id: U, owner_id: U, created_at: D },
  campaigns: { status: T, channel: T, owner_id: U, created_at: D },
  records: { owner_id: U, created_at: D, updated_at: D },
};
