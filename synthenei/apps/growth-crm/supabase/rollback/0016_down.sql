-- EMERGENCY ONLY (BUILD-PLAN 6.5): restores the pre-0016 (0006) row-level security policies. Review in gate 2 before it is ever needed.
-- Does not drop the 0017/0018 tables. Their own policies stay (they rely on authz.*), and 0017 keeps working. Run as the migration owner
-- in a single transaction against the branch first. Re-applying 0016 afterwards (it is idempotent) swaps v2 back in.
begin;
do $$
declare t text; p record;
begin
  foreach t in array array['leads','contacts','accounts','deals','deal_stage_history','activities','tasks','campaigns','campaign_daily_metrics','audience_segments','lead_events','conversations','messages','message_templates','ga4_daily','integrations','integration_field_maps','sync_runs','consent_log','ai_insights','backup_checks','backup_alert_rules','pipeline_stages','territories','sales_targets','invitations','audit_log'] loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;
drop view if exists public.v_contacts_masked, public.v_conversations_masked, public.v_messages_masked;
create or replace view public.v_leads_masked with (security_barrier = true) as
select l.workspace_id, l.id,
       (with n as (select regexp_replace(l.full_name, '^(adv|dr|mr|ms|mrs|thiru|tmt)\.?\s+', '', 'i') as v)
        select split_part(n.v, ' ', 1) || coalesce(' ' || nullif(left(split_part(n.v, ' ', 2), 1), '') || '.', '') from n) as display_name,
       l.role_title, l.firm_name, l.city, l.district, l.status, l.score, l.first_touch_channel,
       l.first_touch_campaign, l.owner_id, l.created_at,
       case when l.email is not null then '•••@' || split_part(l.email, '@', 2) end as email_masked,
       case when l.phone is not null then '••••••' || right(l.phone, 4) end as phone_masked
  from public.leads l
 where l.deleted_at is null
   and l.workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data','viewer'));


-- ---------- business tables ----------
create policy pipeline_stages_select on public.pipeline_stages for select to authenticated
  using (workspace_id in (select public.member_ws_ids()));
create policy pipeline_stages_insert on public.pipeline_stages for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')))
              and (workspace_id in (select public.member_ws_ids())));
create policy pipeline_stages_update on public.pipeline_stages for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')))
              and (workspace_id in (select public.member_ws_ids())));
create policy pipeline_stages_delete on public.pipeline_stages for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')));
create policy territories_select on public.territories for select to authenticated
  using (workspace_id in (select public.member_ws_ids()));
create policy territories_insert on public.territories for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')))
              and (workspace_id in (select public.member_ws_ids())));
create policy territories_update on public.territories for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')))
              and (workspace_id in (select public.member_ws_ids())));
create policy territories_delete on public.territories for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')));
create policy sales_targets_select on public.sales_targets for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','viewer')) or rep_id = (select auth.uid())));
create policy sales_targets_insert on public.sales_targets for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')))
              and (workspace_id in (select public.member_ws_ids())));
create policy sales_targets_update on public.sales_targets for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')))
              and (workspace_id in (select public.member_ws_ids())));
create policy sales_targets_delete on public.sales_targets for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')));

-- accounts (firm-level business data; viewers may read)
create policy accounts_select on public.accounts for select to authenticated
  using (workspace_id in (select public.member_ws_ids()));
create policy accounts_insert on public.accounts for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids())
              and workspace_id in (select public.role_ws_ids('owner','sales_manager','sales_rep','marketing','data')));
create policy accounts_update on public.accounts for update to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','data')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and owner_id = (select auth.uid()))))
  with check (workspace_id in (select public.member_ws_ids()));
create policy accounts_delete on public.accounts for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner')));

-- contacts (personal data): no viewer; reps only own contacts or contacts on their accounts
create policy contacts_select on public.contacts for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data'))
              or (workspace_id in (select public.role_ws_ids('sales_rep')) and (owner_id = (select auth.uid())
                  or exists (select 1 from public.accounts a where a.id = contacts.account_id and a.owner_id = (select auth.uid()))))));
create policy contacts_insert on public.contacts for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids())
              and workspace_id in (select public.role_ws_ids('owner','sales_manager','sales_rep','marketing','data'))
              and (account_id is null or exists (select 1 from public.accounts a where a.id = contacts.account_id)));
create policy contacts_update on public.contacts for update to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','data')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and owner_id = (select auth.uid()))))
  with check (workspace_id in (select public.member_ws_ids()));
create policy contacts_delete on public.contacts for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner')));

-- leads: reps see own + unassigned in their territory; viewers use v_leads_masked
create policy leads_select on public.leads for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data'))
              or (workspace_id in (select public.role_ws_ids('sales_rep')) and (owner_id = (select auth.uid())
                  or (owner_id is null and exists (select 1 from public.territories t
                        where t.workspace_id = leads.workspace_id and t.rep_id = (select auth.uid())
                          and lower(t.district) = lower(leads.district)))))));
create policy leads_insert on public.leads for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data'))
                   or (workspace_id in (select public.role_ws_ids('sales_rep')) and owner_id = (select auth.uid())))
              and (account_id is null or exists (select 1 from public.accounts a where a.id = leads.account_id)));
create policy leads_update on public.leads for update to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data'))
              or (workspace_id in (select public.role_ws_ids('sales_rep')) and (owner_id = (select auth.uid())
                  or (owner_id is null and exists (select 1 from public.territories t
                        where t.workspace_id = leads.workspace_id and t.rep_id = (select auth.uid())
                          and lower(t.district) = lower(leads.district)))))))
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data')) or owner_id = (select auth.uid())));
create policy leads_delete on public.leads for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.member_role_ws_ids('owner')));

-- lead_events
create policy lead_events_select on public.lead_events for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data'))
              or (workspace_id in (select public.role_ws_ids('sales_rep')) and exists (select 1 from public.leads l
                    where l.id = lead_events.lead_id and l.owner_id = (select auth.uid())))));
create policy lead_events_insert on public.lead_events for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids())
              and workspace_id in (select public.role_ws_ids('owner','sales_manager','sales_rep','marketing','data'))
              and (lead_id is null or exists (select 1 from public.leads l where l.id = lead_events.lead_id)));

-- deals: viewers read (no personal data on deals); reps own only
create policy deals_select on public.deals for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data','viewer')) or owner_id = (select auth.uid())));
create policy deals_insert on public.deals for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and owner_id = (select auth.uid())))
              and (lead_id is null or exists (select 1 from public.leads l where l.id = deals.lead_id))
              and (account_id is null or exists (select 1 from public.accounts a where a.id = deals.account_id))
              and (primary_contact_id is null or exists (select 1 from public.contacts c where c.id = deals.primary_contact_id)));
create policy deals_update on public.deals for update to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and owner_id = (select auth.uid()))))
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or owner_id = (select auth.uid()))
              and (lead_id is null or exists (select 1 from public.leads l where l.id = deals.lead_id))
              and (account_id is null or exists (select 1 from public.accounts a where a.id = deals.account_id)));
create policy deals_delete on public.deals for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner')));

create policy dsh_select on public.deal_stage_history for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and exists (select 1 from public.deals d where d.id = deal_stage_history.deal_id));  -- inherits deals RLS

-- activities
create policy activities_select on public.activities for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing'))
              or owner_id = (select auth.uid())
              or (workspace_id in (select public.role_ws_ids('sales_rep')) and exists (select 1 from public.leads l
                    where l.id = activities.lead_id and l.owner_id = (select auth.uid())))));
create policy activities_insert on public.activities for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and owner_id = (select auth.uid())))
              -- referenced rows must be visible to the caller (subqueries run under their RLS)
              and (lead_id is null or exists (select 1 from public.leads l where l.id = activities.lead_id))
              and (deal_id is null or exists (select 1 from public.deals d where d.id = activities.deal_id))
              and (contact_id is null or exists (select 1 from public.contacts c where c.id = activities.contact_id)));
create policy activities_update on public.activities for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or owner_id = (select auth.uid())))
  with check (workspace_id in (select public.member_ws_ids())
              and (lead_id is null or exists (select 1 from public.leads l where l.id = activities.lead_id)));
create policy activities_delete on public.activities for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner')));

-- tasks
create policy tasks_select on public.tasks for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or assignee_id = (select auth.uid()) or created_by = (select auth.uid())));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids()) and not workspace_id in (select public.role_ws_ids('viewer'))
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or assignee_id = (select auth.uid()))
              and (lead_id is null or exists (select 1 from public.leads l where l.id = tasks.lead_id))
              and (deal_id is null or exists (select 1 from public.deals d where d.id = tasks.deal_id)));
create policy tasks_update on public.tasks for update to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or assignee_id = (select auth.uid())))
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or assignee_id = (select auth.uid())));
create policy tasks_delete on public.tasks for delete to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or created_by = (select auth.uid())));

-- campaigns: all roles read names (reps see campaign on a lead); owner + marketing write
create policy campaigns_select on public.campaigns for select to authenticated
  using (workspace_id in (select public.member_ws_ids()));
create policy campaigns_insert on public.campaigns for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing')))
              and (workspace_id in (select public.member_ws_ids())));
create policy campaigns_update on public.campaigns for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing')))
              and (workspace_id in (select public.member_ws_ids())));
create policy campaigns_delete on public.campaigns for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing')));
create policy cdm_select on public.campaign_daily_metrics for select to authenticated
  using (workspace_id in (select public.member_ws_ids()) and not workspace_id in (select public.role_ws_ids('sales_rep')));
create policy cdm_insert on public.campaign_daily_metrics for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing','data')))
              and (workspace_id in (select public.member_ws_ids())));
create policy cdm_update on public.campaign_daily_metrics for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing','data')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing','data')))
              and (workspace_id in (select public.member_ws_ids())));
create policy cdm_delete on public.campaign_daily_metrics for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing','data')));
create policy segments_select on public.audience_segments for select to authenticated
  using (workspace_id in (select public.member_ws_ids()) and not workspace_id in (select public.role_ws_ids('sales_rep')));
create policy segments_insert on public.audience_segments for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing','data')))
              and (workspace_id in (select public.member_ws_ids())));
create policy segments_update on public.audience_segments for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing','data')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing','data')))
              and (workspace_id in (select public.member_ws_ids())));
create policy segments_delete on public.audience_segments for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing','data')));
create policy ga4_select on public.ga4_daily for select to authenticated
  using (workspace_id in (select public.member_ws_ids()) and not workspace_id in (select public.role_ws_ids('sales_rep')));

-- inbox
create policy templates_select on public.message_templates for select to authenticated
  using (workspace_id in (select public.member_ws_ids()));
create policy templates_insert on public.message_templates for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing')))
              and (workspace_id in (select public.member_ws_ids())));
create policy templates_update on public.message_templates for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing')))
              and (workspace_id in (select public.member_ws_ids())));
create policy templates_delete on public.message_templates for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing')));
create policy conversations_select on public.conversations for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing'))
              or (workspace_id in (select public.role_ws_ids('sales_rep')) and assignee_id = (select auth.uid()))));
create policy conversations_insert on public.conversations for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and assignee_id = (select auth.uid()))))
              and (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or assignee_id = (select auth.uid()))
              and (lead_id is null or exists (select 1 from public.leads l where l.id = conversations.lead_id))));
create policy conversations_update on public.conversations for update to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and assignee_id = (select auth.uid()))))
  with check ((workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and assignee_id = (select auth.uid()))))
              and (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or assignee_id = (select auth.uid()))
              and (lead_id is null or exists (select 1 from public.leads l where l.id = conversations.lead_id))));
create policy conversations_delete on public.conversations for delete to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and assignee_id = (select auth.uid()))));
create policy messages_select on public.messages for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and exists (select 1 from public.conversations c where c.id = messages.conversation_id));  -- inherits conversations RLS
create policy messages_insert on public.messages for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids())
              and workspace_id in (select public.role_ws_ids('owner','sales_manager','sales_rep'))
              and sent_by = (select auth.uid())
              and exists (select 1 from public.conversations c where c.id = messages.conversation_id
                          and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or c.assignee_id = (select auth.uid()))));

-- integrations
create policy integrations_select on public.integrations for select to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data')));
create policy integrations_insert on public.integrations for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.member_role_ws_ids('owner')))
              and (workspace_id in (select public.member_ws_ids())));
create policy integrations_update on public.integrations for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.member_role_ws_ids('owner')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.member_role_ws_ids('owner')))
              and (workspace_id in (select public.member_ws_ids())));
create policy integrations_delete on public.integrations for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.member_role_ws_ids('owner')));
create policy ifm_select on public.integration_field_maps for select to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data')));
create policy ifm_insert on public.integration_field_maps for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.member_role_ws_ids('owner','data')))
              and (workspace_id in (select public.member_ws_ids())));
create policy ifm_update on public.integration_field_maps for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.member_role_ws_ids('owner','data')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.member_role_ws_ids('owner','data')))
              and (workspace_id in (select public.member_ws_ids())));
create policy ifm_delete on public.integration_field_maps for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.member_role_ws_ids('owner','data')));
create policy sync_runs_select on public.sync_runs for select to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data')));
create policy sync_runs_insert on public.sync_runs for insert to authenticated   -- CSV imports from the app
  with check (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing','data'))
              and kind = 'csv' and started_by = (select auth.uid()));
create policy sync_runs_update on public.sync_runs for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and started_by = (select auth.uid()))
  with check (workspace_id in (select public.member_ws_ids()));

-- backups (rows are written by the backup job with the service role)
create policy backup_checks_select on public.backup_checks for select to authenticated
  using ((workspace_id is null or workspace_id in (select public.member_ws_ids()))
         and workspace_id in (select public.role_ws_ids('owner','sales_manager','data')));
create policy backup_rules_select on public.backup_alert_rules for select to authenticated
  using ((workspace_id is null or workspace_id in (select public.member_ws_ids()))
         and workspace_id in (select public.role_ws_ids('owner','sales_manager','data')));
create policy backup_rules_insert on public.backup_alert_rules for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner')))
              and (workspace_id in (select public.member_ws_ids())));
create policy backup_rules_update on public.backup_alert_rules for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner')))
              and (workspace_id in (select public.member_ws_ids())));
create policy backup_rules_delete on public.backup_alert_rules for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner')));

-- AI insights: requester or owner/sales_manager
create policy ai_select on public.ai_insights for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (user_id = (select auth.uid()) or workspace_id in (select public.role_ws_ids('owner','sales_manager'))));
create policy ai_insert on public.ai_insights for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids()) and user_id = (select auth.uid()) and not workspace_id in (select public.role_ws_ids('viewer')));
create policy ai_update on public.ai_insights for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and user_id = (select auth.uid()))
  with check (workspace_id in (select public.member_ws_ids()) and user_id = (select auth.uid()));

-- consent_log: append-only
create policy consent_select on public.consent_log for select to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager','data')));
create policy consent_insert on public.consent_log for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids())
              and workspace_id in (select public.role_ws_ids('owner','sales_manager','sales_rep','data'))
              and recorded_by = (select auth.uid())
              and (lead_id is null or exists (select 1 from public.leads l where l.id = consent_log.lead_id)));

-- audit_log: read-only for owner + sales_manager; written only by trigger
create policy audit_select on public.audit_log for select to authenticated
  using (workspace_id in (select public.member_role_ws_ids('owner','sales_manager'))
         or (select public.is_platform_admin()));

-- ---------- reference visibility (cross-row references must point at rows the caller can see) ----------
alter policy leads_insert on public.leads
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data'))
                   or (workspace_id in (select public.role_ws_ids('sales_rep')) and owner_id = (select auth.uid())))
              and (account_id  is null or exists (select 1 from public.accounts  x where x.id = leads.account_id))
              and (contact_id  is null or exists (select 1 from public.contacts  x where x.id = leads.contact_id))
              and (campaign_id is null or exists (select 1 from public.campaigns x where x.id = leads.campaign_id)));
alter policy leads_update on public.leads
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data')) or owner_id = (select auth.uid()))
              and (account_id  is null or exists (select 1 from public.accounts  x where x.id = leads.account_id))
              and (contact_id  is null or exists (select 1 from public.contacts  x where x.id = leads.contact_id))
              and (campaign_id is null or exists (select 1 from public.campaigns x where x.id = leads.campaign_id)));

alter policy deals_insert on public.deals
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and owner_id = (select auth.uid())))
              and (lead_id    is null or exists (select 1 from public.leads    x where x.id = deals.lead_id))
              and (account_id is null or exists (select 1 from public.accounts x where x.id = deals.account_id))
              and (primary_contact_id is null or exists (select 1 from public.contacts x where x.id = deals.primary_contact_id)));
alter policy deals_update on public.deals
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or owner_id = (select auth.uid()))
              and (lead_id    is null or exists (select 1 from public.leads    x where x.id = deals.lead_id))
              and (account_id is null or exists (select 1 from public.accounts x where x.id = deals.account_id))
              and (primary_contact_id is null or exists (select 1 from public.contacts x where x.id = deals.primary_contact_id)));

alter policy activities_insert on public.activities
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and owner_id = (select auth.uid())))
              and (lead_id    is null or exists (select 1 from public.leads    x where x.id = activities.lead_id))
              and (deal_id    is null or exists (select 1 from public.deals    x where x.id = activities.deal_id))
              and (account_id is null or exists (select 1 from public.accounts x where x.id = activities.account_id))
              and (contact_id is null or exists (select 1 from public.contacts x where x.id = activities.contact_id)));
alter policy activities_update on public.activities
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or owner_id = (select auth.uid()))
              and (lead_id    is null or exists (select 1 from public.leads    x where x.id = activities.lead_id))
              and (deal_id    is null or exists (select 1 from public.deals    x where x.id = activities.deal_id))
              and (account_id is null or exists (select 1 from public.accounts x where x.id = activities.account_id))
              and (contact_id is null or exists (select 1 from public.contacts x where x.id = activities.contact_id)));

alter policy tasks_insert on public.tasks
  with check (workspace_id in (select public.member_ws_ids()) and not workspace_id in (select public.role_ws_ids('viewer'))
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or assignee_id = (select auth.uid()))
              and (lead_id is null or exists (select 1 from public.leads x where x.id = tasks.lead_id))
              and (deal_id is null or exists (select 1 from public.deals x where x.id = tasks.deal_id)));
alter policy tasks_update on public.tasks
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or assignee_id = (select auth.uid()))
              and (lead_id is null or exists (select 1 from public.leads x where x.id = tasks.lead_id))
              and (deal_id is null or exists (select 1 from public.deals x where x.id = tasks.deal_id)));

alter policy conversations_insert on public.conversations
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager'))
                   or (workspace_id in (select public.role_ws_ids('sales_rep')) and assignee_id = (select auth.uid())))
              and (lead_id    is null or exists (select 1 from public.leads    x where x.id = conversations.lead_id))
              and (contact_id is null or exists (select 1 from public.contacts x where x.id = conversations.contact_id)));
alter policy conversations_update on public.conversations
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or assignee_id = (select auth.uid()))
              and (lead_id    is null or exists (select 1 from public.leads    x where x.id = conversations.lead_id))
              and (contact_id is null or exists (select 1 from public.contacts x where x.id = conversations.contact_id)));

alter policy ai_insert on public.ai_insights
  with check (workspace_id in (select public.member_ws_ids()) and user_id = (select auth.uid())
              and not workspace_id in (select public.role_ws_ids('viewer'))
              and (lead_id is null or exists (select 1 from public.leads x where x.id = ai_insights.lead_id))
              and (deal_id is null or exists (select 1 from public.deals x where x.id = ai_insights.deal_id))
              and (campaign_id is null or exists (select 1 from public.campaigns x where x.id = ai_insights.campaign_id))
              and (conversation_id is null or exists (select 1 from public.conversations x where x.id = ai_insights.conversation_id)));

alter policy consent_insert on public.consent_log
  with check (workspace_id in (select public.member_ws_ids())
              and workspace_id in (select public.role_ws_ids('owner','sales_manager','sales_rep','data'))
              and recorded_by = (select auth.uid())
              and (lead_id is null or exists (select 1 from public.leads x where x.id = consent_log.lead_id)));

commit;
