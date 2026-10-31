// Public REST API v1 (CONTRACTS C11). Thin route: logic lives in src/lib/api.
import { collection, RESOURCES } from "@/lib/api/crud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST } = collection(RESOURCES.leads);
