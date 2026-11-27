// One definition of every rule that the REST API (src/lib/api/schemas.ts) and the UI server actions
// (src/app/(app)/<resource>/_lib/schemas.ts) both enforce. Numeric bounds and enums mirror the database CHECK
// constraints (live, verified 27 Nov 2026); keep them in step with any migration that changes a CHECK.
import { z } from "zod";

export const MAX = { name: 120, firm: 160, short: 80, text: 200, email: 200, phone: 20, accountName: 160, longText: 300 } as const;

export const INDIAN_MOBILE = /^(\+?91)?[6-9]\d{9}$/;
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
export const PHONE_MESSAGE = "Enter a 10 digit Indian mobile number";
export const EMAIL_MESSAGE = "Enter a valid email address";

export const text = (max: number) => z.string().trim().max(max);
export const phoneText = () => text(MAX.phone).refine((p) => p === "" || INDIAN_MOBILE.test(p.replace(/[\s-]/g, "")), PHONE_MESSAGE);
export const emailText = () => text(MAX.email).refine((e) => e === "" || EMAIL_RE.test(e), EMAIL_MESSAGE);

// CHECK constraints
export const DEAL_PLANS = ["practice", "chambers", "enterprise"] as const; // deals_plan_check
export const ACCOUNT_SIZE_BANDS = ["solo", "2-5", "6-20", "21-50", "50+"] as const; // accounts_size_band_check
export const MEETING_TYPES = ["demo", "discovery", "follow_up", "onboarding"] as const; // activities_meeting_type_check
export const PREFERRED_LANGUAGES = ["en", "ta"] as const; // contacts_preferred_language_check
export const DB_TASK_KINDS = ["first_response", "call", "whatsapp", "email", "follow_up", "demo_prep", "proposal", "other"] as const; // tasks_kind_check
export const SEATS = { min: 1 } as const; // deals_seats_check: seats > 0
export const TASK_PRIORITY = { min: 1, max: 3 } as const; // tasks_priority_check
export const COUNT_MAX = 100000; // accounts_lawyers_count_check / clerks: >= 0

export const seats = () => z.number().int().min(SEATS.min, "Seats must be at least 1");
export const taskPriority = () => z.number().int().min(TASK_PRIORITY.min).max(TASK_PRIORITY.max);
export const headcount = () => z.number().int().min(0).max(COUNT_MAX);

/** Constraint name (from a Postgres 23514/23505 message) -> field path and plain message. */
export const CONSTRAINT_FIELDS: Record<string, { path: string; message: string }> = {
  deals_seats_check: { path: "seats", message: "must be greater than 0" },
  deals_plan_check: { path: "plan", message: `must be one of ${DEAL_PLANS.join(", ")}` },
  deals_value_inr_check: { path: "value_inr", message: "must not be negative" },
  tasks_priority_check: { path: "priority", message: "must be between 1 and 3" },
  tasks_kind_check: { path: "kind", message: `must be one of ${DB_TASK_KINDS.join(", ")}` },
  accounts_size_band_check: { path: "size_band", message: `must be one of ${ACCOUNT_SIZE_BANDS.join(", ")}` },
  accounts_lawyers_count_check: { path: "lawyers_count", message: "must not be negative" },
  accounts_clerks_count_check: { path: "clerks_count", message: "must not be negative" },
  activities_duration_mins_check: { path: "duration_mins", message: "must not be negative" },
  activities_meeting_type_check: { path: "meeting_type", message: `must be one of ${MEETING_TYPES.join(", ")}` },
  contacts_preferred_language_check: { path: "preferred_language", message: "must be en or ta" },
  leads_score_check: { path: "score", message: "must be between 0 and 100" },
};
export function fieldForConstraint(detail: string | undefined): { path: string; message: string } | null {
  if (!detail) return null;
  for (const [name, f] of Object.entries(CONSTRAINT_FIELDS)) if (detail.includes(name)) return f;
  return null;
}
