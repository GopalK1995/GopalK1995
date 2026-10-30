import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "invalid id");
// Demo ids are slugs (u-…), real ids are uuids: member/user ids accept both, db-only ids are uuids.
export const idAny = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "invalid id");
const scope = z.enum(["none", "own", "team", "all"]);
const baseRole = z.enum(["owner", "sales_manager", "sales_rep", "marketing", "data", "viewer"]);
const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().max(160).regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, "email"),
  fullName: text(0, 80).optional(),
  roleId: idAny,
  districts: z.array(text(1, 60)).max(40).default([]),
});
export const changeRoleSchema = z.object({ userId: idAny, roleId: idAny });
export const memberIdSchema = z.object({ userId: idAny });
export const attributesSchema = z.object({
  userId: idAny,
  districts: z.array(text(1, 60)).max(60),
  regions: z.array(text(1, 60)).max(30),
});

export const grantSchema = z.object({
  permission: z.string().min(3).max(80),
  scope,
  conditions: z.unknown().optional(),
  fieldMask: z.array(z.string().min(1).max(60)).max(40).optional(),
});
export const roleBodySchema = z.object({
  name: text(2, 60),
  description: text(0, 240).default(""),
  baseRole,
  grants: z.array(grantSchema).max(200),
});
export const createRoleSchema = roleBodySchema.extend({ cloneOf: uuid.optional() });
export const updateRoleSchema = roleBodySchema.extend({ roleId: uuid, expectedUpdatedAt: z.string().min(10).max(40) });
export const deleteRoleSchema = z.object({ roleId: uuid });

export const teamSchema = z.object({ name: text(2, 80), parentTeamId: uuid.nullable().default(null) });
export const updateTeamSchema = teamSchema.extend({ teamId: uuid });
export const teamMemberSchema = z.object({ teamId: uuid, userId: idAny, isManager: z.boolean().default(false) });
export const removeTeamMemberSchema = z.object({ teamId: uuid, userId: idAny });
export const deleteTeamSchema = z.object({ teamId: uuid });
export const explainSchema = z.object({ permission: z.string().min(3).max(80), roleId: idAny.optional() });
