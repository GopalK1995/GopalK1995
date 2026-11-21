// GET /api/search?q=  Global search and palette bootstrap (T056). Results come from the caller's own session (RLS), never the service role.
import { getSession } from "@/lib/auth/server";
import { handleSearch } from "@/lib/search/handler";
import { runSearch } from "@/lib/search/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (req: Request) => handleSearch(req, { uid: async () => (await getSession())?.uid ?? null, run: runSearch });
