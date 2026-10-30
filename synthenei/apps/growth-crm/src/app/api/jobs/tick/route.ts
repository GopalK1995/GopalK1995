// POST/GET /api/jobs/tick: drains the pgmq queues (BUILD-PLAN 1.6, CONTRACTS C8.2).
// Called by pg_cron through pg_net (JOBS_TICK_SECRET) and by Vercel Cron (CRON_SECRET, GET).
import { NextResponse } from "next/server";
import { serviceDb } from "@/lib/db/service";
import { loadEnv } from "@/lib/env";
import { tickAuthorized } from "@/lib/jobs/auth";
import { jobLogger, runTick } from "@/lib/jobs/tick";
import { requestIdFrom } from "@/lib/obs/request-id";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };

async function handle(req: Request): Promise<NextResponse> {
  const env = loadEnv();
  // Demo deployments have no database and no queues: the route does not exist there.
  if (env.demoMode || !env.supabaseConfigured || !env.serviceRoleKey) return NextResponse.json({ error: "not found" }, { status: 404, headers });
  if (!tickAuthorized(req.headers.get("authorization"), [env.jobsTickSecret, env.cronSecret])) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  }
  const requestId = requestIdFrom(req.headers);
  try {
    const r = await runTick(serviceDb(), requestId);
    return NextResponse.json({ processed: r.processed, failed: r.failed, dead: r.dead, deferred: r.deferred, ms: r.ms, stoppedBy: r.stoppedBy, scheduled: r.scheduled }, { headers });
  } catch (e) {
    jobLogger({ request_id: requestId }).error("tick failed", { error: e instanceof Error ? e.message.slice(0, 200) : "error" });
    return NextResponse.json({ error: "tick failed" }, { status: 500, headers });
  }
}

export const POST = handle;
export const GET = handle;
