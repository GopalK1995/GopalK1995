"use server";
// Data-health mutations. assertCan first (support sessions are covered by the catalogue), RLS second where the request client
// writes. Demo sessions never touch a database. backup_checks has no user insert policy, so drill rows and "Run check" use the
// service client AFTER the permission check, scoped to the active workspace.
import { z } from "zod";
import { actorFromPrincipal, audit } from "@/lib/audit/record";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { requireActive } from "@/lib/auth/server";
import { assertCan } from "@/lib/authz/load";
import { dbForRequest } from "@/lib/db/client";
import { serviceDb } from "@/lib/db/service";
import { evaluateWorkspace } from "@/lib/backups/evaluate";
import { runHeartbeat } from "@/lib/backups/heartbeat";
import { DEFAULT_RULE_LIST } from "@/lib/backups/rules";
import { supabaseBackupStore } from "@/lib/backups/store";

const DEMO_NOTE = "Demo workspace: nothing is saved.";
const uuid = z.string().uuid();
const drillInput = z.object({ result: z.enum(["pass", "fail"]), durationMin: z.number().int().min(0).max(1440), notes: z.string().trim().max(500) });
export type DrillInput = z.infer<typeof drillInput>;

const ctx = async () => { const { session, active } = await requireActive(); return { demo: session.demo === true, ws: active.ws.uuid, tenant: active.tenant.id }; };

/** Evaluates this workspace's alert rules now with the same code as the hourly job (and notifies, deduplicated). */
export async function runHealthCheck(): Promise<ActionResult<{ findings: number }>> {
  return runAction(async () => {
    const c = await ctx();
    await assertCan("data_health.manage");
    if (c.demo) return okResult("Check passed on sample values", { sub: DEMO_NOTE, data: { findings: 0 } });
    const r = await evaluateWorkspace(supabaseBackupStore(serviceDb()), { id: c.ws, tenantId: c.tenant });
    const sub = [r.createdDefaults && "Default alert rules were created.", r.health.bootstrapped && "A first heartbeat was recorded.", r.notified > 0 && `${r.notified} notifications sent.`].filter(Boolean).join(" ") || undefined;
    return okResult(r.findings ? `${r.findings} alert${r.findings === 1 ? " is" : "s are"} firing` : "Check passed: nothing is firing", { sub, data: { findings: r.findings } });
  });
}

/** Records a heartbeat for this workspace now. It also becomes the baseline the row-drop rule compares against. */
export async function recordHeartbeatNow(): Promise<ActionResult> {
  return runAction(async () => {
    const c = await ctx();
    await assertCan("data_health.manage");
    if (c.demo) return okResult("Heartbeat recorded", { sub: DEMO_NOTE });
    const r = await runHeartbeat(supabaseBackupStore(serviceDb()), { workspaceId: c.ws });
    return r.written ? okResult("Heartbeat recorded", { sub: "Row counts saved; this is now the baseline for the row-drop rule." }) : failResult("error", "Heartbeat could not be recorded");
  });
}

/** First-time setup: persists the default rules for this workspace. Does nothing when rules already exist. */
export async function createDefaultRules(): Promise<ActionResult> {
  return runAction(async () => {
    const c = await ctx();
    const p = await assertCan("backups.manage");
    if (c.demo) return okResult("Default rules created", { sub: DEMO_NOTE });
    const store = supabaseBackupStore(await dbForRequest());
    if ((await store.rules(c.ws)).length) return okResult("Rules already exist");
    await store.insertRules({ id: c.ws, tenantId: c.tenant }, DEFAULT_RULE_LIST);
    await audit(actorFromPrincipal(p), { action: "backup.rules_created", summary: `Created ${DEFAULT_RULE_LIST.length} default alert rules`, object: { table: "backup_alert_rules" } });
    return okResult("Default alert rules created", { sub: "The full-dump rule starts paused." });
  });
}

export async function setAlertRule(id: string, enabled: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const c = await ctx();
    const p = await assertCan("backups.manage");
    if (c.demo) return okResult(`Alert rule ${enabled ? "enabled" : "paused"}`, { sub: DEMO_NOTE });
    const rid = uuid.parse(id);
    const db = await dbForRequest();
    const { data, error } = await (db as unknown as { from(t: string): { update(v: object): { eq(c: string, v: string): { eq(c: string, v: string): { select(c: string): PromiseLike<{ data: unknown[] | null; error: unknown }> } } } } })
      .from("backup_alert_rules").update({ enabled }).eq("id", rid).eq("workspace_id", c.ws).select("id");
    if (error || !data?.length) return failResult("not_found", "That rule no longer exists.");
    await audit(actorFromPrincipal(p), { action: "backup.rule_toggled", summary: `Alert rule ${enabled ? "enabled" : "paused"}`, object: { table: "backup_alert_rules", id: rid } });
    return okResult(`Alert rule ${enabled ? "enabled" : "paused"}`);
  });
}

export async function logRestoreDrill(input: DrillInput): Promise<ActionResult> {
  return runAction(async () => {
    const c = await ctx();
    const p = await assertCan("data_health.manage");
    const v = drillInput.parse(input);
    if (c.demo) return okResult(`Restore drill recorded as ${v.result}`, { sub: DEMO_NOTE });
    const id = await supabaseBackupStore(serviceDb()).insertCheck({
      workspaceId: c.ws, tenantId: c.tenant, kind: "restore_drill", status: v.result === "pass" ? "success" : "failed", takenAt: new Date().toISOString(),
      location: "scratch database", detail: JSON.stringify({ durationMin: v.durationMin, notes: v.notes }),
    });
    await audit(actorFromPrincipal(p), { action: "backup.drill_logged", summary: `Restore drill logged as ${v.result}`, object: { table: "backup_checks", id: String(id) } });
    return okResult(`Restore drill recorded as ${v.result}`, { sub: "Saved to the drill log." });
  });
}
