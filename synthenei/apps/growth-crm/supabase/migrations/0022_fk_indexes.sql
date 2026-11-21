-- 0022_fk_indexes (T041): covering indexes for the 40 foreign keys the performance advisor flags.
-- Additive and idempotent. Plain CREATE INDEX (tables are small; no CONCURRENTLY inside a migration).
-- On the partitioned table `events` the index is created on the parent and cascades to every partition.

create index if not exists ai_policies_updated_by_fk_idx on public.ai_policies (updated_by);
create index if not exists api_keys_bot_user_id_fk_idx on public.api_keys (bot_user_id);
create index if not exists api_keys_role_id_fk_idx on public.api_keys (role_id);
create index if not exists api_keys_tenant_id_fk_idx on public.api_keys (tenant_id);
create index if not exists comments_author_id_fk_idx on public.comments (author_id);
create index if not exists comments_tenant_id_fk_idx on public.comments (tenant_id);
create index if not exists events_tenant_id_fk_idx on public.events (tenant_id);
create index if not exists external_links_tenant_id_fk_idx on public.external_links (tenant_id);
create index if not exists idempotency_keys_tenant_id_fk_idx on public.idempotency_keys (tenant_id);
create index if not exists job_runs_workspace_id_fk_idx on public.job_runs (workspace_id);
create index if not exists layouts_role_id_fk_idx on public.layouts (role_id);
create index if not exists layouts_tenant_id_fk_idx on public.layouts (tenant_id);
create index if not exists layouts_workspace_id_fk_idx on public.layouts (workspace_id);
create index if not exists meta_assets_tenant_id_fk_idx on public.meta_assets (tenant_id);
create index if not exists notification_prefs_workspace_id_fk_idx on public.notification_prefs (workspace_id);
create index if not exists notification_rules_tenant_id_fk_idx on public.notification_rules (tenant_id);
create index if not exists notifications_actor_id_fk_idx on public.notifications (actor_id);
create index if not exists notifications_tenant_id_fk_idx on public.notifications (tenant_id);
create index if not exists oauth_states_connector_id_fk_idx on public.oauth_states (connector_id);
create index if not exists oauth_states_tenant_id_fk_idx on public.oauth_states (tenant_id);
create index if not exists oauth_states_workspace_id_fk_idx on public.oauth_states (workspace_id);
create index if not exists pipeline_stages_workspace_id_fk_idx on public.pipeline_stages (workspace_id);
create index if not exists pipelines_tenant_id_fk_idx on public.pipelines (tenant_id);
create index if not exists record_links_tenant_id_fk_idx on public.record_links (tenant_id);
create index if not exists records_object_type_id_fk_idx on public.records (object_type_id);
create index if not exists records_tenant_id_fk_idx on public.records (tenant_id);
create index if not exists relationship_tuples_tenant_id_fk_idx on public.relationship_tuples (tenant_id);
create index if not exists saved_views_object_type_id_fk_idx on public.saved_views (object_type_id);
create index if not exists saved_views_owner_id_fk_idx on public.saved_views (owner_id);
create index if not exists saved_views_tenant_id_fk_idx on public.saved_views (tenant_id);
create index if not exists scheduled_jobs_workspace_id_fk_idx on public.scheduled_jobs (workspace_id);
create index if not exists social_account_metrics_daily_tenant_id_fk_idx on public.social_account_metrics_daily (tenant_id);
create index if not exists social_accounts_tenant_id_fk_idx on public.social_accounts (tenant_id);
create index if not exists social_post_metrics_daily_tenant_id_fk_idx on public.social_post_metrics_daily (tenant_id);
create index if not exists social_posts_tenant_id_fk_idx on public.social_posts (tenant_id);
create index if not exists sync_runs_job_run_id_fk_idx on public.sync_runs (job_run_id);
create index if not exists teams_tenant_id_fk_idx on public.teams (tenant_id);
create index if not exists webhook_endpoints_tenant_id_fk_idx on public.webhook_endpoints (tenant_id);
create index if not exists webhook_inbox_integration_id_fk_idx on public.webhook_inbox (integration_id);
create index if not exists webhook_inbox_tenant_id_fk_idx on public.webhook_inbox (tenant_id);
