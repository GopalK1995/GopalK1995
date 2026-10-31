// Public REST API v1 (CONTRACTS C11). Thin route: logic lives in src/lib/api.
import { item, RESOURCES } from "@/lib/api/crud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, PATCH, DELETE } = item(RESOURCES.deals);
