-- 0003 RLS on every table + tenant/role policies.
-- Changes vs schema.sql: helper/auth calls wrapped in (select ...) (initplan, evaluated once per statement);
-- each "for all" write policy split into insert/update/delete so SELECT has one permissive policy per table,
-- and the role check (USING) now also applies to INSERT and to the new row on UPDATE (FOR ALL never applied USING
-- to inserts, so in schema.sql any tenant member could insert pipeline stages, territories, campaigns, integrations, ...).
-- Derived from apps/growth-crm/supabase/schema.sql. Apply in filename order.

-- =====================================================================
-- 18. Row Level Security
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['tenants','profiles','invitations','pipeline_stages','territories','sales_targets',
    'accounts','contacts','campaigns','campaign_daily_metrics','audience_segments','leads','lead_events',
    'deals','deal_stage_history','activities','tasks','message_templates','conversations','messages',
    'ga4_daily','integrations','integration_field_maps','sync_runs','backup_checks','backup_alert_rules',
    'ai_insights','consent_log','audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Helper calls are wrapped as (select fn()) so Postgres evaluates them once per statement (initplan),
-- not once per row (Supabase advisor: auth_rls_initplan).
-- tenants
create policy tenants_select on public.tenants for select to authenticated
  using (id = (select public.current_tenant_id()));
create policy tenants_update on public.tenants for update to authenticated
  using (id = (select public.current_tenant_id()) and (select public.has_role('owner')))
  with check (id = (select public.current_tenant_id()));

-- profiles (helpers are SECURITY DEFINER, so no recursion)
create policy profiles_select on public.profiles for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy profiles_update on public.profiles for update to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (id = (select auth.uid()) or (select public.has_role('owner','sales_manager'))))
  with check (tenant_id = (select public.current_tenant_id()));

-- invitations: owner any role; sales_manager only rep/viewer
create policy invitations_select on public.invitations for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager')));
create policy invitations_insert on public.invitations for insert to authenticated
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager')))
              and (tenant_id = (select public.current_tenant_id())
              and ((select public.has_role('owner')) or ((select public.has_role('sales_manager')) and role in ('sales_rep','viewer')))));
create policy invitations_update on public.invitations for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager')))
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager')))
              and (tenant_id = (select public.current_tenant_id())
              and ((select public.has_role('owner')) or ((select public.has_role('sales_manager')) and role in ('sales_rep','viewer')))));
create policy invitations_delete on public.invitations for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager')));

-- config tables: everyone in tenant reads; owner + sales_manager write
create policy pipeline_stages_select on public.pipeline_stages for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy pipeline_stages_insert on public.pipeline_stages for insert to authenticated
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager')))
              and (tenant_id = (select public.current_tenant_id())));
create policy pipeline_stages_update on public.pipeline_stages for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager')))
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager')))
              and (tenant_id = (select public.current_tenant_id())));
create policy pipeline_stages_delete on public.pipeline_stages for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager')));
create policy territories_select on public.territories for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy territories_insert on public.territories for insert to authenticated
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager')))
              and (tenant_id = (select public.current_tenant_id())));
create policy territories_update on public.territories for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager')))
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager')))
              and (tenant_id = (select public.current_tenant_id())));
create policy territories_delete on public.territories for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager')));
create policy sales_targets_select on public.sales_targets for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.has_role('owner','sales_manager','viewer')) or rep_id = (select auth.uid())));
create policy sales_targets_insert on public.sales_targets for insert to authenticated
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager')))
              and (tenant_id = (select public.current_tenant_id())));
create policy sales_targets_update on public.sales_targets for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager')))
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager')))
              and (tenant_id = (select public.current_tenant_id())));
create policy sales_targets_delete on public.sales_targets for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager')));

-- accounts (firm-level business data; viewers may read)
create policy accounts_select on public.accounts for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy accounts_insert on public.accounts for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.has_role('owner','sales_manager','sales_rep','marketing','data')));
create policy accounts_update on public.accounts for update to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.has_role('owner','sales_manager','data')) or ((select public.has_role('sales_rep')) and owner_id = (select auth.uid()))))
  with check (tenant_id = (select public.current_tenant_id()));
create policy accounts_delete on public.accounts for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner')));

-- contacts (personal data): no viewer; reps only own contacts or contacts on their accounts
create policy contacts_select on public.contacts for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.has_role('owner','sales_manager','marketing','data'))
              or ((select public.has_role('sales_rep')) and (owner_id = (select auth.uid())
                  or exists (select 1 from public.accounts a where a.id = contacts.account_id and a.owner_id = (select auth.uid()))))));
create policy contacts_insert on public.contacts for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.has_role('owner','sales_manager','sales_rep','marketing','data'))
              and (account_id is null or exists (select 1 from public.accounts a where a.id = contacts.account_id)));
create policy contacts_update on public.contacts for update to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.has_role('owner','sales_manager','data')) or ((select public.has_role('sales_rep')) and owner_id = (select auth.uid()))))
  with check (tenant_id = (select public.current_tenant_id()));
create policy contacts_delete on public.contacts for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner')));

-- leads: reps see own + unassigned in their territory; viewers use v_leads_masked
create policy leads_select on public.leads for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.has_role('owner','sales_manager','marketing','data'))
              or ((select public.has_role('sales_rep')) and (owner_id = (select auth.uid())
                  or (owner_id is null and exists (select 1 from public.territories t
                        where t.tenant_id = leads.tenant_id and t.rep_id = (select auth.uid())
                          and lower(t.district) = lower(leads.district)))))));
create policy leads_insert on public.leads for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id())
              and ((select public.has_role('owner','sales_manager','marketing','data'))
                   or ((select public.has_role('sales_rep')) and owner_id = (select auth.uid())))
              and (account_id is null or exists (select 1 from public.accounts a where a.id = leads.account_id)));
create policy leads_update on public.leads for update to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.has_role('owner','sales_manager','marketing','data'))
              or ((select public.has_role('sales_rep')) and (owner_id = (select auth.uid())
                  or (owner_id is null and exists (select 1 from public.territories t
                        where t.tenant_id = leads.tenant_id and t.rep_id = (select auth.uid())
                          and lower(t.district) = lower(leads.district)))))))
  with check (tenant_id = (select public.current_tenant_id())
              and ((select public.has_role('owner','sales_manager','marketing','data')) or owner_id = (select auth.uid())));
create policy leads_delete on public.leads for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner')));

-- lead_events
create policy lead_events_select on public.lead_events for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.has_role('owner','sales_manager','marketing','data'))
              or ((select public.has_role('sales_rep')) and exists (select 1 from public.leads l
                    where l.id = lead_events.lead_id and l.owner_id = (select auth.uid())))));
create policy lead_events_insert on public.lead_events for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.has_role('owner','sales_manager','sales_rep','marketing','data'))
              and (lead_id is null or exists (select 1 from public.leads l where l.id = lead_events.lead_id)));

-- deals: viewers read (no personal data on deals); reps own only
create policy deals_select on public.deals for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.has_role('owner','sales_manager','marketing','data','viewer')) or owner_id = (select auth.uid())));
create policy deals_insert on public.deals for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id())
              and ((select public.has_role('owner','sales_manager')) or ((select public.has_role('sales_rep')) and owner_id = (select auth.uid())))
              and (lead_id is null or exists (select 1 from public.leads l where l.id = deals.lead_id))
              and (account_id is null or exists (select 1 from public.accounts a where a.id = deals.account_id))
              and (primary_contact_id is null or exists (select 1 from public.contacts c where c.id = deals.primary_contact_id)));
create policy deals_update on public.deals for update to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.has_role('owner','sales_manager')) or ((select public.has_role('sales_rep')) and owner_id = (select auth.uid()))))
  with check (tenant_id = (select public.current_tenant_id())
              and ((select public.has_role('owner','sales_manager')) or owner_id = (select auth.uid()))
              and (lead_id is null or exists (select 1 from public.leads l where l.id = deals.lead_id))
              and (account_id is null or exists (select 1 from public.accounts a where a.id = deals.account_id)));
create policy deals_delete on public.deals for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner')));

create policy dsh_select on public.deal_stage_history for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and exists (select 1 from public.deals d where d.id = deal_stage_history.deal_id));  -- inherits deals RLS

-- activities
create policy activities_select on public.activities for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.has_role('owner','sales_manager','marketing'))
              or owner_id = (select auth.uid())
              or ((select public.has_role('sales_rep')) and exists (select 1 from public.leads l
                    where l.id = activities.lead_id and l.owner_id = (select auth.uid())))));
create policy activities_insert on public.activities for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id())
              and ((select public.has_role('owner','sales_manager')) or ((select public.has_role('sales_rep')) and owner_id = (select auth.uid())))
              -- referenced rows must be visible to the caller (subqueries run under their RLS)
              and (lead_id is null or exists (select 1 from public.leads l where l.id = activities.lead_id))
              and (deal_id is null or exists (select 1 from public.deals d where d.id = activities.deal_id))
              and (contact_id is null or exists (select 1 from public.contacts c where c.id = activities.contact_id)));
create policy activities_update on public.activities for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and ((select public.has_role('owner','sales_manager')) or owner_id = (select auth.uid())))
  with check (tenant_id = (select public.current_tenant_id())
              and (lead_id is null or exists (select 1 from public.leads l where l.id = activities.lead_id)));
create policy activities_delete on public.activities for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner')));

-- tasks
create policy tasks_select on public.tasks for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.has_role('owner','sales_manager')) or assignee_id = (select auth.uid()) or created_by = (select auth.uid())));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and not (select public.has_role('viewer'))
              and ((select public.has_role('owner','sales_manager')) or assignee_id = (select auth.uid()))
              and (lead_id is null or exists (select 1 from public.leads l where l.id = tasks.lead_id))
              and (deal_id is null or exists (select 1 from public.deals d where d.id = tasks.deal_id)));
create policy tasks_update on public.tasks for update to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.has_role('owner','sales_manager')) or assignee_id = (select auth.uid())))
  with check (tenant_id = (select public.current_tenant_id())
              and ((select public.has_role('owner','sales_manager')) or assignee_id = (select auth.uid())));
create policy tasks_delete on public.tasks for delete to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.has_role('owner','sales_manager')) or created_by = (select auth.uid())));

-- campaigns: all roles read names (reps see campaign on a lead); owner + marketing write
create policy campaigns_select on public.campaigns for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy campaigns_insert on public.campaigns for insert to authenticated
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','marketing')))
              and (tenant_id = (select public.current_tenant_id())));
create policy campaigns_update on public.campaigns for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','marketing')))
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','marketing')))
              and (tenant_id = (select public.current_tenant_id())));
create policy campaigns_delete on public.campaigns for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','marketing')));
create policy cdm_select on public.campaign_daily_metrics for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and not (select public.has_role('sales_rep')));
create policy cdm_insert on public.campaign_daily_metrics for insert to authenticated
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','marketing','data')))
              and (tenant_id = (select public.current_tenant_id())));
create policy cdm_update on public.campaign_daily_metrics for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','marketing','data')))
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','marketing','data')))
              and (tenant_id = (select public.current_tenant_id())));
create policy cdm_delete on public.campaign_daily_metrics for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','marketing','data')));
create policy segments_select on public.audience_segments for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and not (select public.has_role('sales_rep')));
create policy segments_insert on public.audience_segments for insert to authenticated
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','marketing','data')))
              and (tenant_id = (select public.current_tenant_id())));
create policy segments_update on public.audience_segments for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','marketing','data')))
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','marketing','data')))
              and (tenant_id = (select public.current_tenant_id())));
create policy segments_delete on public.audience_segments for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','marketing','data')));
create policy ga4_select on public.ga4_daily for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and not (select public.has_role('sales_rep')));

-- inbox
create policy templates_select on public.message_templates for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy templates_insert on public.message_templates for insert to authenticated
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager','marketing')))
              and (tenant_id = (select public.current_tenant_id())));
create policy templates_update on public.message_templates for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager','marketing')))
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager','marketing')))
              and (tenant_id = (select public.current_tenant_id())));
create policy templates_delete on public.message_templates for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager','marketing')));
create policy conversations_select on public.conversations for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.has_role('owner','sales_manager','marketing'))
              or ((select public.has_role('sales_rep')) and assignee_id = (select auth.uid()))));
create policy conversations_insert on public.conversations for insert to authenticated
  with check ((tenant_id = (select public.current_tenant_id())
         and ((select public.has_role('owner','sales_manager')) or ((select public.has_role('sales_rep')) and assignee_id = (select auth.uid()))))
              and (tenant_id = (select public.current_tenant_id())
              and ((select public.has_role('owner','sales_manager')) or assignee_id = (select auth.uid()))
              and (lead_id is null or exists (select 1 from public.leads l where l.id = conversations.lead_id))));
create policy conversations_update on public.conversations for update to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.has_role('owner','sales_manager')) or ((select public.has_role('sales_rep')) and assignee_id = (select auth.uid()))))
  with check ((tenant_id = (select public.current_tenant_id())
         and ((select public.has_role('owner','sales_manager')) or ((select public.has_role('sales_rep')) and assignee_id = (select auth.uid()))))
              and (tenant_id = (select public.current_tenant_id())
              and ((select public.has_role('owner','sales_manager')) or assignee_id = (select auth.uid()))
              and (lead_id is null or exists (select 1 from public.leads l where l.id = conversations.lead_id))));
create policy conversations_delete on public.conversations for delete to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.has_role('owner','sales_manager')) or ((select public.has_role('sales_rep')) and assignee_id = (select auth.uid()))));
create policy messages_select on public.messages for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and exists (select 1 from public.conversations c where c.id = messages.conversation_id));  -- inherits conversations RLS
create policy messages_insert on public.messages for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.has_role('owner','sales_manager','sales_rep'))
              and sent_by = (select auth.uid())
              and exists (select 1 from public.conversations c where c.id = messages.conversation_id
                          and ((select public.has_role('owner','sales_manager')) or c.assignee_id = (select auth.uid()))));

-- integrations
create policy integrations_select on public.integrations for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager','marketing','data')));
create policy integrations_insert on public.integrations for insert to authenticated
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner')))
              and (tenant_id = (select public.current_tenant_id())));
create policy integrations_update on public.integrations for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner')))
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner')))
              and (tenant_id = (select public.current_tenant_id())));
create policy integrations_delete on public.integrations for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner')));
create policy ifm_select on public.integration_field_maps for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager','marketing','data')));
create policy ifm_insert on public.integration_field_maps for insert to authenticated
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','data')))
              and (tenant_id = (select public.current_tenant_id())));
create policy ifm_update on public.integration_field_maps for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','data')))
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','data')))
              and (tenant_id = (select public.current_tenant_id())));
create policy ifm_delete on public.integration_field_maps for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','data')));
create policy sync_runs_select on public.sync_runs for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager','marketing','data')));
create policy sync_runs_insert on public.sync_runs for insert to authenticated   -- CSV imports from the app
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','marketing','data'))
              and kind = 'csv' and started_by = (select auth.uid()));
create policy sync_runs_update on public.sync_runs for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and started_by = (select auth.uid()))
  with check (tenant_id = (select public.current_tenant_id()));

-- backups (rows are written by the backup job with the service role)
create policy backup_checks_select on public.backup_checks for select to authenticated
  using ((tenant_id is null or tenant_id = (select public.current_tenant_id()))
         and (select public.has_role('owner','sales_manager','data')));
create policy backup_rules_select on public.backup_alert_rules for select to authenticated
  using ((tenant_id is null or tenant_id = (select public.current_tenant_id()))
         and (select public.has_role('owner','sales_manager','data')));
create policy backup_rules_insert on public.backup_alert_rules for insert to authenticated
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner')))
              and (tenant_id = (select public.current_tenant_id())));
create policy backup_rules_update on public.backup_alert_rules for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner')))
  with check ((tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner')))
              and (tenant_id = (select public.current_tenant_id())));
create policy backup_rules_delete on public.backup_alert_rules for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner')));

-- AI insights: requester or owner/sales_manager
create policy ai_select on public.ai_insights for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (user_id = (select auth.uid()) or (select public.has_role('owner','sales_manager'))));
create policy ai_insert on public.ai_insights for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid()) and not (select public.has_role('viewer')));
create policy ai_update on public.ai_insights for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid()))
  with check (tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid()));

-- consent_log: append-only
create policy consent_select on public.consent_log for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager','data')));
create policy consent_insert on public.consent_log for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.has_role('owner','sales_manager','sales_rep','data'))
              and recorded_by = (select auth.uid())
              and (lead_id is null or exists (select 1 from public.leads l where l.id = consent_log.lead_id)));

-- audit_log: read-only for owner + sales_manager; written only by trigger
create policy audit_select on public.audit_log for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_role('owner','sales_manager')));
