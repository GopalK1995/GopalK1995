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
};
export const KIND_ICON: Record<Task["kind"], typeof Phone> = { call: Phone, whatsapp: MessageCircle, email: Mail, demo: CalendarCheck, follow_up: Clock, proposal: FileText };
export const KIND_LABEL: Record<Task["kind"], string> = { call: "Call", whatsapp: "WhatsApp", email: "Email", demo: "Demo", follow_up: "Follow-up", proposal: "Proposal" };

/** "yes" can edit, "support" blocked by a read-only support session (show disabled), "no" hidden. */
export function useTaskPerm() {
  const { role, support } = useSession();
  const edit: "yes" | "support" | "no" = !canEdit(accessFor(role, "/tasks")) ? "no" : support?.mode === "read_only" ? "support" : "yes";
  return { edit, reassign: can("assignLeads", { role, support }) };
}

const DAY = 86400e3;
/** IST wall-clock -> ISO. */
export const istIso = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`).toISOString();
export function snoozeTargets(now: string) {
  const n = new Date(now).getTime();
  const tomorrow = dayKey(new Date(n + DAY).toISOString());
  const dow = new Date(dayKey(now) + "T12:00:00Z").getUTCDay(); // 0 Sun
  const toMon = ((8 - dow) % 7) || 7;
  const monday = dayKey(new Date(n + toMon * DAY).toISOString());
  return [
    { key: "1h", label: "In 1 hour", iso: new Date(n + 3600e3).toISOString() },
    { key: "tomorrow", label: "Tomorrow 10:00", iso: istIso(tomorrow, "10:00") },
    { key: "monday", label: "Next Monday 10:00", iso: istIso(monday, "10:00") },
  ];
}
