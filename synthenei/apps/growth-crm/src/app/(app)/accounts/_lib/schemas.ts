// Input schemas for account and contact writes (zod). Pure: shared by server actions, UI and unit tests.
import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
const uuid = z.string().uuid();
export const version = z.number().int().min(1);
const phone = text(20).refine((p) => p === "" || /^(\+?91)?[6-9]\d{9}$/.test(p.replace(/[\s-]/g, "")), "Enter a 10 digit Indian mobile number");
const email = text(200).refine((e) => e === "" || /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e), "Enter a valid email address");

export const ACCOUNT_STATUSES = ["prospect", "trial", "customer", "churned"] as const;

export const createAccountSchema = z.object({
  name: text(160).min(1, "Name is required"),
  city: text(80).optional().default(""),
  district: text(80).optional().default(""),
  website: text(200).optional().default(""),
  lawyersCount: z.number().int().min(0).max(100000).nullable().optional(),
  ownerId: uuid.nullable().optional(),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = z.object({
  expectedVersion: version,
  patch: z.object({
    name: text(160).min(1, "Name is required"),
    city: text(80), district: text(80), website: text(200),
    customerStatus: z.enum(ACCOUNT_STATUSES),
    lawyersCount: z.number().int().min(0).max(100000).nullable(),
  }).partial().refine((p) => Object.keys(p).length > 0, "Nothing to change"),
});
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const assignAccountSchema = z.object({ expectedVersion: version, ownerId: uuid.nullable() });
export const deleteSchema = z.object({ expectedVersion: version });
export const mergeSchema = z.object({ targetId: z.string().min(1), sourceVersion: version, targetVersion: version });

export const createContactSchema = z.object({
  fullName: text(120).min(1, "Name is required"),
  roleTitle: text(120).optional().default(""),
  email: email.optional().default(""),
  phone: phone.optional().default(""),
  accountId: uuid.nullable().optional(),
  isDecisionMaker: z.boolean().optional().default(false),
  ownerId: uuid.nullable().optional(),
});
export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = z.object({
  expectedVersion: version,
  patch: z.object({
    fullName: text(120).min(1, "Name is required"), roleTitle: text(120), email, phone,
    accountId: uuid.nullable(), isDecisionMaker: z.boolean(),
  }).partial().refine((p) => Object.keys(p).length > 0, "Nothing to change"),
});
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
