// Loads the /analytics/social view. Real sessions read through the request client (RLS: analytics.read + workspace membership), so a user
// never sees another workspace's rows; demo sessions get labelled sample data and never create a client. Server only.
import "server-only";
import { requireActive } from "@/lib/auth/server";
import { loadPrincipal } from "@/lib/authz/load";
import { can } from "@/lib/authz";
import { dbForRequest } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import { demoView } from "./demo";
import { assembleView, type SocialView, type Raw } from "./view";

const WINDOW_DAYS = 90;
type R = Record<string, unknown>;

export async function loadSocialView(): Promise<SocialView> {
  const { session, active } = await requireActive();
  const now = new Date();
  if (session.demo) return demoView(now);
  const empty = assembleView({ accounts: [], posts: [], postMetrics: [], accountMetrics: [], connections: [] });
  if (!can(await loadPrincipal(), "analytics.read")) return { ...empty, state: "permission_denied" };
  const ws = active.ws.uuid, since = new Date(now.getTime() - WINDOW_DAYS * 86400e3), sinceDay = since.toISOString().slice(0, 10);
  try {
    const db = await dbForRequest();
    const rows = async (b: ReturnType<typeof from>): Promise<R[]> => { const r = await b; if (r.error) throw new Error("read failed"); return (r.data as R[] | null) ?? []; };
    const [conns, accounts, posts, postMetrics, accountMetrics] = await Promise.all([
      rows(from(db, "integrations").select("id, status, oauth_scopes").eq("workspace_id", ws).eq("connector_id", "meta-ads").limit(50)),
      rows(from(db, "social_accounts").select("id, platform, external_id, display_name, username, followers, last_synced_at, last_sync_status, last_error, integration_id").eq("workspace_id", ws).limit(100)),
      rows(from(db, "social_posts").select("id, account_id, kind, caption, permalink, posted_at, status").eq("workspace_id", ws).gte("posted_at", since.toISOString()).order("posted_at", { ascending: false }).limit(500)),
      rows(from(db, "social_post_metrics_daily").select("post_id, day, impressions, reach, likes, comments, shares, saves, video_views, link_clicks, engagement_rate").eq("workspace_id", ws).gte("day", sinceDay).limit(5000)),
      rows(from(db, "social_account_metrics_daily").select("account_id, day, followers, reach").eq("workspace_id", ws).gte("day", sinceDay).limit(1000)),
    ]);
    let lastSkip: Raw["lastSkip"] = null;
    try {
      const ids = conns.map((c) => String(c.id));
      const run = ids.length ? (await rows(from(db, "sync_runs").select("payload_sample").in("integration_id", ids).eq("stream", "social").order("started_at", { ascending: false }).limit(1)))[0] : undefined;
      const s = (run?.payload_sample as { rows?: { skipped?: string; missing_scopes?: string[] } } | null)?.rows;
      if (s?.skipped) lastSkip = { skipped: s.skipped, missing: s.missing_scopes };
    } catch { /* run history is optional */ }
    return assembleView({
      accounts, posts, postMetrics, accountMetrics, lastSkip,
      connections: conns.map((c) => ({ id: String(c.id), status: String(c.status), scopes: Array.isArray(c.oauth_scopes) ? (c.oauth_scopes as unknown[]).filter((s): s is string => typeof s === "string") : [] })),
    });
  } catch {
    return { ...empty, state: "error", errorSource: "Instagram and Facebook metrics" };
  }
}
