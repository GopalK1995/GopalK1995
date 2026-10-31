// Public REST API v1 (CONTRACTS C11). Thin route: logic lives in src/lib/api.
import { pipelines } from "@/lib/api/misc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = pipelines();
