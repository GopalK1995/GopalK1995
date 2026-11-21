// Labelled sample data for demo sessions only (the page shows a "Sample data" band). Deterministic, pure, never stored, never mixed with a real workspace.
import { assembleView, type Raw, type SocialView } from "./view";

const DAY = 86400e3;
const KINDS = ["feed", "reel", "carousel", "story", "video"] as const;
const rnd = (seed: number) => { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; };

export function demoRaw(now: Date): Raw {
  const r = rnd(71), today = now.toISOString().slice(0, 10);
  const day = (n: number) => new Date(now.getTime() - n * DAY).toISOString().slice(0, 10);
  const accounts = [
    { id: "demo-ig", platform: "instagram", external_id: "demo-ig", display_name: "Sample studio", username: "sample.studio", followers: 4820, last_synced_at: now.toISOString(), last_sync_status: "ok", last_error: null },
    { id: "demo-fb", platform: "facebook", external_id: "demo-fb", display_name: "Sample studio (Page)", username: null, followers: 2310, last_synced_at: now.toISOString(), last_sync_status: "ok", last_error: null },
  ];
  const posts: Record<string, unknown>[] = [], postMetrics: Record<string, unknown>[] = [];
  for (let i = 0; i < 22; i++) {
    const ig = i % 3 !== 2, kind = ig ? KINDS[i % 4] : "feed", age = 1 + i * 2, id = `demo-p${i}`;
    posts.push({ id, account_id: ig ? "demo-ig" : "demo-fb", external_id: id, kind, caption: `Sample post ${i + 1}`, permalink: null, posted_at: new Date(now.getTime() - age * DAY).toISOString(), status: kind === "story" ? "expired" : "live" });
    const base = Math.round((kind === "reel" ? 3200 : 900) * (0.5 + r()));
    for (let d = Math.min(age, 5); d >= 0; d--) {
      const k = 1 - d / 7, reach = Math.round(base * k);
      // a few posts are deliberately missing numbers: unknown stays null, never 0
      const missing = i % 7 === 6;
      postMetrics.push({ post_id: id, day: day(d), impressions: missing ? null : Math.round(reach * 1.3), reach: missing ? null : reach, likes: missing ? null : Math.round(reach * 0.06), comments: missing ? null : Math.round(reach * 0.006),
        shares: missing ? null : Math.round(reach * 0.01), saves: missing ? null : Math.round(reach * 0.015), video_views: null, link_clicks: null, engagement_rate: missing || !reach ? null : 0.09 });
    }
  }
  const accountMetrics = Array.from({ length: 30 }, (_, i) => {
    const d = 29 - i;
    return [
      { account_id: "demo-ig", day: day(d), followers: 4820 - d * 3, follower_delta: 3, profile_views: 120, reach: Math.round(2600 + r() * 900), website_clicks: 14 },
      { account_id: "demo-fb", day: day(d), followers: 2310 - d, follower_delta: 1, profile_views: 60, reach: Math.round(1100 + r() * 400), website_clicks: 6 },
    ];
  }).flat();
  void today;
  return { accounts, posts, postMetrics, accountMetrics, connections: [{ id: "demo-conn", status: "showcase", scopes: [] }] };
}
export const demoView = (now: Date): SocialView => assembleView(demoRaw(now), { demo: true });
