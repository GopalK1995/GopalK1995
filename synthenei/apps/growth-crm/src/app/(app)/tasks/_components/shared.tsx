"use client";
// Shared bits for the task list and the week calendar.
import { CalendarCheck, Clock, FileText, Mail, MessageCircle, Phone } from "lucide-react";
import { useSession } from "@/components/shell/providers";
import { accessFor, can, canEdit } from "@/lib/auth/roles";
import { dayKey } from "@/lib/format";
import type { Task } from "@/lib/data/types";

export type TaskRow = {
  id: string; title: string; kind: Task["kind"]; due: string; priority: Task["priority"]; ownerId: string; owner: string;
  lead: { id: string; name: string; firm: string } | null;
  /** Row version for optimistic concurrency (real sessions); null in the demo workspace. */
  version: number | null;
  firstResponse: boolean;
};
export type TaskStrings = Record<string, string>;
/** Fills {placeholders} in a string from the namespace. */
export const sub = (s: string | undefined, vars: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (m, k: string) => String(k in vars ? vars[k] : m));

export const KIND_ICON: Record<Task["kind"], typeof Phone> = { call: Phone, whatsapp: MessageCircle, email: Mail, demo: CalendarCheck, follow_up: Clock, proposal: FileText };

/** edit: "yes" can edit, "support" blocked by a read-only support session, "no" lacks the role permission. Both blocked states render disabled with a reason. */
export function useTaskPerm() {
  const { role, support } = useSession();
  const edit: "yes" | "support" | "no" = !canEdit(accessFor(role, "/tasks")) ? "no" : support?.mode === "read_only" ? "support" : "yes";
  const reassign: "yes" | "support" | "no" = !can("assignLeads", { role, support: undefined }) ? "no" : support?.mode === "read_only" ? "support" : "yes";
  return { edit, reassign };
}
/** Reason text for a blocked control, or null when allowed. */
export const blockedReason = (state: "yes" | "support" | "no", t: TaskStrings, need: "disabledNeedsWrite" | "disabledNeedsAssign" = "disabledNeedsWrite") =>
  state === "yes" ? null : state === "support" ? t.disabledSupport : t[need];

const DAY = 86400e3;
/** IST wall-clock -> ISO. */
export const istIso = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`).toISOString();
/** HH:MM of an instant in IST (24h, for time inputs). */
export const istHm = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(11, 16);
export function snoozeTargets(now: string, t: TaskStrings) {
  const n = new Date(now).getTime();
  const tomorrow = dayKey(new Date(n + DAY).toISOString());
  const dow = new Date(dayKey(now) + "T12:00:00Z").getUTCDay(); // 0 Sun
  const toMon = ((8 - dow) % 7) || 7;
  const monday = dayKey(new Date(n + toMon * DAY).toISOString());
  return [
    { key: "1h", label: t.snooze1h, iso: new Date(n + 3600e3).toISOString() },
    { key: "tomorrow", label: t.snoozeTomorrow, iso: istIso(tomorrow, "10:00") },
    { key: "monday", label: t.snoozeMonday, iso: istIso(monday, "10:00") },
  ];
}
