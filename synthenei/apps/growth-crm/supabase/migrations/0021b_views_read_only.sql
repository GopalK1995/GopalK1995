-- F1 (docs/gates/db-advisor-review-2026-11-08.md): the v_* views are owner-run and auto-updatable; API roles must not write through them.
-- Applied to Lawsome 8 Nov 2026 as migration 0021b_views_read_only.
revoke insert, update, delete, truncate, references, trigger
  on public.v_activity_feed, public.v_backup_latest, public.v_campaign_perf,
     public.v_campaign_reach_profile, public.v_contacts_masked, public.v_conversations_masked,
     public.v_crm_accounts, public.v_crm_campaign_days, public.v_crm_campaigns, public.v_crm_deals,
     public.v_crm_leads, public.v_crm_tasks, public.v_funnel_daily, public.v_job_runs_tenant,
     public.v_leads_masked, public.v_messages_masked, public.v_pipeline_summary,
     public.v_rep_scorecard, public.v_sync_freshness
  from anon, authenticated, public;
