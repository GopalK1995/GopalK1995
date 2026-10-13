-- 0009 grants. anon: no table/view access at all; only the intake RPCs. authenticated: table privileges
-- (RLS decides rows), helpers and app RPCs. Trigger/internal functions: nobody.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

do $$
declare t text;
begin
  foreach t in array array['profiles','invitations','pipeline_stages','territories','sales_targets',
    'accounts','contacts','campaigns','campaign_daily_metrics','audience_segments','leads','lead_events',
    'deals','activities','tasks','message_templates','conversations','messages',
    'integrations','integration_field_maps','sync_runs','backup_alert_rules','ai_insights'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
-- read-mostly tables: writes only through RPCs / triggers / service role
revoke all on public.tenants, public.workspaces, public.memberships, public.platform_admins, public.support_sessions,
              public.deal_stage_history, public.ga4_daily, public.backup_checks, public.audit_log, public.consent_log
  from authenticated;
grant select on public.tenants, public.workspaces, public.memberships, public.platform_admins, public.support_sessions,
                public.deal_stage_history, public.ga4_daily, public.backup_checks, public.audit_log, public.consent_log
  to authenticated;
grant update on public.tenants, public.workspaces to authenticated;              -- branding / workspace settings (RLS)
grant update, delete on public.memberships to authenticated;                     -- role change / removal (RLS + guard)
grant insert on public.consent_log to authenticated;                             -- append-only
grant select on public.v_funnel_daily, public.v_campaign_perf, public.v_campaign_reach_profile,
                public.v_pipeline_summary, public.v_rep_scorecard, public.v_leads_masked,
                public.v_backup_latest, public.v_sync_freshness to authenticated;

-- functions
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_platform_admin(), public.member_ws_ids(), public.role_ws_ids(public.app_role[]),
  public.member_role_ws_ids(public.app_role[]), public.is_member(uuid), public.has_ws_role(uuid, public.app_role[]),
  public.has_member_role(uuid, public.app_role[]), public.has_active_support_session(uuid), public.ws_role(uuid),
  public.member_tenant_ids(), public.owner_tenant_ids(), public.co_member_ids()
  to authenticated;
grant execute on function public.my_workspaces(), public.invite_member(uuid, text, public.app_role, text, text[]),
  public.create_workspace(uuid, text, text, text), public.admin_create_tenant(text, text, jsonb, text, text),
  public.start_support_session(uuid, text, text, int), public.end_support_session(uuid, uuid),
  public.admin_workspace_stats(), public.admin_set_tenant_status(uuid, text),
  public.erase_lead(uuid, text)
  to authenticated;
grant execute on function public.tenant_branding(text, text) to anon, authenticated;
grant execute on function public.submit_lead(text, text, text, text, text, text, text, text, text,
                          boolean, boolean, boolean, text, jsonb, jsonb, text, text) to anon, authenticated;
grant execute on function public.track_event(text, text, text, text, jsonb, jsonb) to anon, authenticated;

-- objects created later (dashboard or future migrations run as postgres) start closed to anon/public
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;
