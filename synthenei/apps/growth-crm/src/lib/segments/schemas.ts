// Input schemas for campaign, metrics and segment writes (zod). Pure: shared by server actions and unit tests.
import { z } from "zod";
import { LIMITS } from "./fields";

const version = z.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-31.");
const optDay = day.nullable().optional();
const count = z.number().int().min(0).max(2_000_000_000);

export const CAMPAIGN_CHANNELS = ["linkedin", "meta", "google_ads", "whatsapp", "email", "referral"] as const;
const money = z.number().finite().min(0).max(1_000_000_000);
const name = z.string().trim().min(4, "Use at least 4 characters for the name.").max(120, "Keep the name under 120 characters.");
const order = (p: { startsOn?: string | null; endsOn?: string | null }) => !p.startsOn || !p.endsOn || p.startsOn <= p.endsOn;

export const createCampaignSchema = z.object({
  name, channel: z.enum(CAMPAIGN_CHANNELS, { message: "Pick a channel." }),
  district: z.string().trim().max(60).default("statewide"), theme: z.string().trim().max(40).default(""),
  budget: money.positive("Budget must be a positive INR amount."),
  objective: z.string().trim().max(300).optional(), startsOn: optDay, endsOn: optDay, segmentId: z.string().uuid().nullable().optional(),
}).refine(order, { message: "End date must be on or after the start date.", path: ["endsOn"] });
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

/** UTM and channel are fixed after creation so attribution holds. */
export const editCampaignSchema = z.object({
  expectedVersion: version,
  patch: z.object({
    name: name.optional(), objective: z.string().trim().max(300).nullable().optional(), budget: money.positive().optional(),
    startsOn: optDay, endsOn: optDay, ownerId: z.string().uuid().nullable().optional(), segmentId: z.string().uuid().nullable().optional(),
  }).refine((p) => Object.keys(p).length > 0, "Nothing to change.")
    .refine(order, { message: "End date must be on or after the start date.", path: ["endsOn"] }),
});
export const statusSchema = z.object({ expectedVersion: version, status: z.enum(["active", "paused", "archived"]) });
export const noteSchema = z.object({ expectedVersion: version, note: z.string().trim().min(3, "Write a note of at least 3 characters.").max(2000) });

export const metricsRowSchema = z.object({
  day, spend: money, impressions: count.default(0), reach: count.default(0), clicks: count.default(0), reactions: count.default(0),
  comments: count.default(0), shares: count.default(0), opens: count.default(0), bounces: count.default(0), unsubscribes: count.default(0), platformLeads: count.default(0),
}).refine((r) => r.impressions === 0 || r.clicks <= r.impressions, { message: "Clicks cannot exceed impressions.", path: ["clicks"] });
export type MetricsRowInput = z.infer<typeof metricsRowSchema>;
export const metricsEntrySchema = z.object({ campaignId: z.string().uuid(), row: metricsRowSchema });

const ruleSchema = z.object({ field: z.string().min(1).max(60), op: z.literal("in").optional(), values: z.array(z.string()).max(LIMITS.values) });
export const saveSegmentSchema = z.object({
  name: z.string().trim().min(3, "Give the segment a name (3 to 80 characters).").max(LIMITS.nameLen),
  rules: z.array(ruleSchema).max(LIMITS.rules), isIcp: z.boolean().optional(),
});
export const updateSegmentSchema = saveSegmentSchema.extend({ expectedVersion: version });
