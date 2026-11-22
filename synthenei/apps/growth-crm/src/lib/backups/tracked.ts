// Tables whose row counts the heartbeat records per workspace. All carry workspace_id. Pure (safe for client code).
export const TRACKED_TABLES = [
  "leads", "contacts", "accounts", "deals", "activities", "tasks", "campaigns", "campaign_daily_metrics", "ga4_daily",
  "conversations", "consent_log", "social_posts", "records",
] as const;
