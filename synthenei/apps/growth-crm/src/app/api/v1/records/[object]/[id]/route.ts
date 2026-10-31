// Public REST API v1 (CONTRACTS C11). Thin route: logic lives in src/lib/api.
import { recordsItem } from "@/lib/api/crud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, PATCH, DELETE } = recordsItem();
