import { requirePlatformAdmin } from "@/lib/auth/server";
import { serviceDb } from "@/lib/db/service";
import { loadEnv } from "@/lib/env";
import { supabaseQueuePort } from "@/lib/jobs/ports";
import { QUEUES, dlqName, type QueueName } from "@/lib/jobs/queues";
import { fmtDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { emitTestEvent, requeueDead } from "./actions";

export const metadata = { title: "Queues and jobs" };
export const dynamic = "force-dynamic";

interface Health { depth?: Record<string, number>; oldest_age_s?: Record<string, number>; failed_1h?: number }
interface Run { id: number; queue: string; kind: string; status: string; attempt: number; started_at: string; ms: number | null; error: string | null }
interface DeadMsg { msg_id: number; message: { kind?: string; dead_reason?: string } }

const age = (s: number | undefined) => (s === undefined ? "-" : s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`);
const tone = (s: string) => (s === "succeeded" ? "success" : s === "dead" || s === "failed" ? "danger" : "neutral");
const th = "py-1.5 pr-3 font-medium";

export default async function OpsPage() {
  const me = await requirePlatformAdmin();
  const e = loadEnv();
  const liveDb = !me.demo && !e.demoMode && e.supabaseConfigured && !!e.serviceRoleKey;

  if (!liveDb) {
    return (
      <>
        <PageHeader eyebrow="Synthan platform" title="Queues and jobs" sub="Queue depths, oldest message age, dead-letter queue and recent job runs." />
        <Card><CardBody className="pt-5 text-[13px] text-ink-2" data-testid="ops-disabled">Queues exist only on deployments with a database. This demo deployment has none.</CardBody></Card>
      </>
    );
  }

  const db = serviceDb();
  const port = supabaseQueuePort(db);
  const [healthRes, runsRes] = await Promise.all([
    (db as unknown as { rpc(fn: string): PromiseLike<{ data: unknown }> }).rpc("queue_health"),
    (db as unknown as { from(t: string): any /* eslint-disable-line @typescript-eslint/no-explicit-any */ }).from("job_runs").select("id, queue, kind, status, attempt, started_at, ms, error").order("id", { ascending: false }).limit(40),
  ]);
  const health = (healthRes.data ?? {}) as Health;
  const runs = (runsRes.data ?? []) as unknown as Run[];
  const dead: [QueueName, DeadMsg[]][] = [];
  for (const q of QUEUES) {
    if ((health.depth?.[dlqName(q)] ?? 0) === 0) continue;
    // Peek with a short visibility timeout so the message is back in view for a requeue almost at once.
    dead.push([q, (await port.read(dlqName(q), 1, 20).catch(() => [])) as unknown as DeadMsg[]]);
  }

  return (
    <>
      <PageHeader eyebrow="Synthan platform" title="Queues and jobs" sub="Queue depths, oldest message age, dead-letter queue and recent job runs. Refresh to update."
        actions={<form action={emitTestEvent}><Button type="submit" data-testid="ops-emit-test">Emit test event</Button></form>} />
      <div className="grid gap-4">
        <Card>
          <CardHeader title="Queues" sub={`${health.failed_1h ?? 0} failed or dead runs in the last hour`} />
          <CardBody className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-[13px]" data-testid="ops-queues">
              <caption className="sr-only">Queue depth and oldest message age</caption>
              <thead><tr className="text-left text-ink-3"><th className={th}>Queue</th><th className={th}>Waiting</th><th className={th}>Oldest</th><th className="py-1.5 font-medium">Dead-lettered</th></tr></thead>
              <tbody>
                {QUEUES.map((q) => (
                  <tr key={q} className="border-t border-line">
                    <td className="py-1.5 pr-3 font-mono text-[12px]">{q}</td>
                    <td className="num py-1.5 pr-3">{health.depth?.[q] ?? 0}</td>
                    <td className="num py-1.5 pr-3">{age(health.oldest_age_s?.[q])}</td>
                    <td className="num py-1.5">{(health.depth?.[dlqName(q)] ?? 0) > 0 ? <Badge tone="danger">{health.depth?.[dlqName(q)]}</Badge> : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Dead-letter queue" sub="Requeue sends the message back with a fresh attempt count. Fix the cause first." />
          <CardBody>
            {dead.length === 0 ? <p className="text-[13px] text-ink-2" data-testid="ops-dlq-empty">Nothing dead-lettered.</p> : dead.map(([q, msgs]) => (
              <div key={q} className="mb-3">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="font-mono text-[12px]">{dlqName(q)}</span>
                  <form action={requeueDead}><input type="hidden" name="queue" value={q} /><Button type="submit" size="sm">Requeue all shown</Button></form>
                </div>
                <ul className="divide-y divide-line text-[13px]">
                  {msgs.map((m) => (
                    <li key={m.msg_id} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="min-w-0 truncate"><span className="font-mono text-[12px]">{m.message.kind ?? "unknown"}</span><span className="ml-2 text-ink-3">{m.message.dead_reason ?? ""}</span></span>
                      <form action={requeueDead}><input type="hidden" name="queue" value={q} /><input type="hidden" name="msgId" value={m.msg_id} /><Button type="submit" size="sm" variant="ghost">Requeue</Button></form>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent runs" sub="Newest first. Hover a row for the error text." />
          <CardBody className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]" data-testid="ops-runs">
              <caption className="sr-only">Recent job runs</caption>
              <thead><tr className="text-left text-ink-3"><th className={th}>When (IST)</th><th className={th}>Queue</th><th className={th}>Kind</th><th className={th}>Status</th><th className={th}>Try</th><th className="py-1.5 font-medium">ms</th></tr></thead>
              <tbody>
                {runs.length === 0 && <tr><td colSpan={6} className="py-3 text-ink-2">No runs yet.</td></tr>}
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-line" title={r.error ?? undefined}>
                    <td className="num py-1.5 pr-3 text-ink-2">{fmtDateTime(r.started_at)}</td>
                    <td className="py-1.5 pr-3 font-mono text-[12px]">{r.queue}</td>
                    <td className="py-1.5 pr-3 font-mono text-[12px]">{r.kind}</td>
                    <td className="py-1.5 pr-3"><Badge tone={tone(r.status)}>{r.status}</Badge></td>
                    <td className="num py-1.5 pr-3">{r.attempt}</td>
                    <td className="num py-1.5">{r.ms ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
