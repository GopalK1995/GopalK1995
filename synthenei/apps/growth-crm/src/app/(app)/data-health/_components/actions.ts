"use server";
// Data-health mutations. Server re-checks role and support mode; demo never persists.
import { requireActive } from "@/lib/auth/server";
import { getBackupAdapter } from "@/lib/data/backup";
import { pageCtx } from "@/lib/data/context";

export type ActionResult = { ok: boolean; message: string; detail?: string };
const OPERATORS = ["owner", "data"] as const;

/** Re-reads the heartbeat and evaluates the alert rules now (the 09:00 IST cron does the same). */
export async function runHealthCheck(): Promise<ActionResult> {
  const { active, ds } = await pageCtx();
  if (active.support?.mode === "read_only") return { ok: false, message: "Read-only support session", detail: "Checks cannot be started." };
  if (!(OPERATORS as readonly string[]).includes(active.role)) return { ok: false, message: "Owner or Data only." };
  const snap = await getBackupAdapter(active.ws).getSnapshot();
  const dump = snap.checks.find((c) => c.kind === "logical_dump");
  const ageH = dump?.takenAt ? (new Date(ds.now()).getTime() - new Date(dump.takenAt).getTime()) / 3600e3 : Infinity;
  const stale = ageH > snap.staleAfterHours;
  return {
    ok: !stale,
    message: stale ? `Heartbeat is stale: no dump in ${snap.staleAfterHours} h` : `Check passed: last dump ${Math.round(ageH)} h ago`,
    detail: `Threshold ${snap.staleAfterHours} h · ${snap.alertRules.filter((r) => r.enabled).length} rules evaluated · sample values, nothing was saved.`,
  };
}

export async function setAlertRule(id: number, enabled: boolean): Promise<ActionResult> {
  const { active } = await requireActive();
  if (active.support?.mode === "read_only") return { ok: false, message: "Read-only support session" };
  if (active.role !== "owner") return { ok: false, message: "Only the Owner edits alert rules." };
  return { ok: true, message: `Alert rule ${id} ${enabled ? "enabled" : "paused"}`, detail: "Demo: nothing was saved." };
}

export async function logRestoreDrill(result: "pass" | "fail"): Promise<ActionResult> {
  const { active } = await requireActive();
  if (active.support?.mode === "read_only") return { ok: false, message: "Read-only support session" };
  if (!(OPERATORS as readonly string[]).includes(active.role)) return { ok: false, message: "Owner or Data only." };
  return { ok: true, message: `Restore drill recorded as ${result}`, detail: "Would write a backup_checks row (restore_drill). Demo: nothing was saved." };
}
