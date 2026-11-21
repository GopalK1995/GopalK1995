// Sample data for demo sessions. Clearly labelled sample data; demo sessions never read or write the database.
import type { Breach } from "./breach";
import type { PrivacyRequest } from "./types";

const DAY = 86_400_000;
const iso = (now: number, offsetDays: number) => new Date(now + offsetDays * DAY).toISOString();

export function demoRequests(now: number, workspaceId: string): (PrivacyRequest & { leadLabel: string | null })[] {
  const base = { workspaceId, handledBy: null, exportPath: null, completedAt: null } as const;
  return [
    { ...base, id: "demo-req-1", subjectRef: "a".repeat(64), leadId: "LD-1001", kind: "erasure", receivedAt: iso(now, -34), dueAt: iso(now, -4), status: "in_progress", notes: "Requester note: please delete everything.", leadLabel: "Sample lead A" },
    { ...base, id: "demo-req-2", subjectRef: "b".repeat(64), leadId: "LD-1002", kind: "access", receivedAt: iso(now, -9), dueAt: iso(now, 21), status: "received", notes: null, leadLabel: "Sample lead B" },
    { ...base, id: "demo-req-3", subjectRef: "c".repeat(64), leadId: null, kind: "correction", receivedAt: iso(now, -3), dueAt: iso(now, 3), status: "received", notes: "Requester note: my phone number changed.", leadLabel: null },
    { ...base, id: "demo-req-4", subjectRef: "d".repeat(64), leadId: "LD-1003", kind: "withdrawal", receivedAt: iso(now, -12), dueAt: iso(now, 18), status: "completed", notes: "Withdrawal applied automatically when the requester verified their address.", completedAt: iso(now, -12), leadLabel: "Sample lead C" },
  ];
}

export function demoBreaches(now: number): Breach[] {
  return [{
    id: "demo-breach-1", detectedAt: iso(now, -2), occurredAt: iso(now, -3), summary: "Sample: a spreadsheet of enquiries was emailed to the wrong address.", categories: ["names", "phone numbers"],
    affectedCount: 40, severity: "medium", status: "open", boardNotifiedAt: null, individualsNotifiedAt: null, remediation: "Recipient asked to delete it.", createdAt: iso(now, -2),
  }];
}

export const DEMO_RULES = [
  { objectType: "lead", days: 730, action: "anonymise" as const },
  { objectType: "lead_event", days: 365, action: "delete" as const },
];
