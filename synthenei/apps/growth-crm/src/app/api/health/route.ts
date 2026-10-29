import { NextResponse } from "next/server";
import { serviceDb } from "@/lib/db/service";
import { summarize, type Check, type QueueCheck } from "@/lib/obs/health";
import { REQUEST_ID_HEADER, requestIdFrom } from "@/lib/obs/request-id";

export const dynamic = "force-dynamic";

type Rpc = { data: unknown; error: { message: string } | null };
type Probe = {
  from(t: string): { select(c: string, o: { head: boolean; count: "exact" }): { limit(n: number): PromiseLike<{ error: { message: string } | null }> } };
  rpc(fn: string): PromiseLike<Rpc>;
};

async function timed<T>(fn: () => Promise<T>): Promise<{ v?: T; err?: string; ms: number }> {
  const t = Date.now();
  try { return { v: await fn(), ms: Date.now() - t }; } catch (e) { return { err: e instanceof Error ? e.message : "error", ms: Date.now() - t }; }
}

export async function GET(req: Request) {
  const rid = requestIdFrom(req.headers);
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  let db: Check = { status: "skipped", detail: "no database configured (demo)" };
  let queues: QueueCheck = { status: "skipped", detail: "no database configured" };
  if (configured) {
    const client = serviceDb() as unknown as Probe;
    const d = await timed(async () => {
      const r = await client.from("accounts").select("id", { head: true, count: "exact" }).limit(1);
      if (r.error) throw new Error(r.error.message);
    });
    db = d.err ? { status: "error", detail: "db round-trip failed", ms: d.ms } : { status: "ok", ms: d.ms };
    // Queue stats RPC arrives with migration 0014; until then a failure is reported as skipped, not an error.
    const q = await timed(async () => {
      const r = await client.rpc("queue_health");
      if (r.error) throw new Error(r.error.message);
      return r.data as { oldest_age_s?: Record<string, number>; failed_1h?: number } | null;
    });
    queues = q.err || !q.v
      ? { status: "skipped", detail: "queue stats not available yet", ms: q.ms }
      : { status: "ok", ms: q.ms, oldest_message_age_s: q.v.oldest_age_s ?? {}, failed_jobs_1h: q.v.failed_1h ?? null };
  }
  const report = summarize(db, queues);
  return NextResponse.json(report, { status: report.status === "down" ? 503 : 200, headers: { [REQUEST_ID_HEADER]: rid, "cache-control": "no-store" } });
}
