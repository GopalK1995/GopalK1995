-- 0011 compatibility views for the Next.js data layer (snake_case -> camelCase maps 1:1 to src/lib/data/types.ts).
-- security_invoker = true: these are plain projections, so the caller's RLS on the base tables applies unchanged
-- (a viewer gets no rows from v_crm_leads, a rep only own/territory leads, etc.). Filter by workspace_id in the app.

create view public.v_crm_leads with (security_invoker = true) as
select l.id, l.workspace_id, l.tenant_id,
       l.full_name as name, l.role_title as title, l.firm_name, l.account_id, l.email, l.phone, l.city, l.district,
       l.status,
       -- derived funnel stage (spec section 14)
       case when d.is_lost or l.status = 'disqualified' then 'lost'
            when d.is_won then 'won'
            when d.key = 'demo_scheduled' then 'demo_booked'
            when d.key = 'demo_done' then 'demo_done'
            when d.key in ('proposal','negotiation') then 'proposal'
            when d.key = 'discovery' then 'qualified'
            when l.status = 'new' then 'new'
            when l.status in ('contacted','nurturing') then 'contacted'
            else 'qualified' end as stage,
       l.owner_id, l.first_touch_channel as channel, l.campaign_id, l.utm,
       l.utm->>'source' as utm_source, l.utm->>'medium' as utm_medium, l.utm->>'campaign' as utm_campaign,
       l.first_touch_channel::text as first_touch, l.last_touch_channel::text as last_touch,
       l.first_touch_campaign, l.last_touch_campaign,
       l.created_at, l.last_touch_at,
       round(extract(epoch from (l.first_response_at - l.created_at)) / 60)::int as first_response_mins,
       l.next_step_at as next_action_at, d.next_step as next_action,
       l.score, l.score_factors, d.value_inr as potential_value, d.id as deal_id,
       '{}'::text[] as tags, l.personal_email, l.consent_demo_followup, l.consent_whatsapp, l.consent_marketing,
       l.is_synthetic
  from public.leads l
  left join lateral (
    select dl.id, dl.value_inr, dl.next_step, s.key, s.is_won, s.is_lost
      from public.deals dl join public.pipeline_stages s on s.id = dl.stage_id
     where dl.lead_id = l.id and dl.deleted_at is null
     order by dl.created_at desc limit 1) d on true
 where l.deleted_at is null;

create view public.v_crm_accounts with (security_invoker = true) as
select a.id, a.workspace_id, a.tenant_id, a.name, a.city, a.address_line as locality, a.district,
       a.court_focus as courts, a.practice_areas, a.size_band as size, a.lawyers_count as lawyers, a.website,
       a.owner_id, a.customer_status as status, a.current_tools, a.sites_count, a.created_at,
       (select max(x.created_at) from public.activities x where x.account_id = a.id) as last_activity_at,
       a.is_synthetic
  from public.accounts a
 where a.deleted_at is null;

create view public.v_crm_deals with (security_invoker = true) as
select d.id, d.workspace_id, d.tenant_id, d.name, d.account_id, d.lead_id, d.owner_id,
       s.key as stage, s.label as stage_label, s.probability, d.value_inr as value, d.seats, d.plan,
       d.created_at, d.expected_close_on as expected_close, d.stage_entered_at, d.won_at, d.lost_at,
       d.lost_reason, d.competitor, d.objections, d.next_step, d.next_step_at, d.is_synthetic
  from public.deals d join public.pipeline_stages s on s.id = d.stage_id
 where d.deleted_at is null;

create view public.v_crm_tasks with (security_invoker = true) as
select t.id, t.workspace_id, t.tenant_id, t.title, t.kind, t.assignee_id as owner_id, t.created_by,
       case t.priority when 1 then 'high' when 2 then 'normal' else 'low' end as priority,
       t.due_at, t.status, t.completed_at, t.lead_id, t.deal_id, t.created_at
  from public.tasks t;

create view public.v_crm_campaigns with (security_invoker = true) as
select c.id, c.workspace_id, c.tenant_id, c.name, c.channel,
       case c.status when 'active' then 'live' else c.status end as status,
       c.objective, c.starts_on as start_date, c.ends_on as end_date, c.budget_inr as budget,
       c.utm_source, c.utm_medium, c.utm_campaign, c.owner_id, c.notes, c.is_synthetic, c.created_at
  from public.campaigns c;

create view public.v_crm_campaign_days with (security_invoker = true) as
select m.workspace_id, m.tenant_id, m.campaign_id, m.day as date, m.spend_inr as spend, m.impressions, m.reach,
       m.clicks, m.platform_leads, (m.reactions + m.comments + m.shares) as engagements, m.opens, m.bounces,
       m.unsubscribes, m.source
  from public.campaign_daily_metrics m;

revoke all on public.v_crm_leads, public.v_crm_accounts, public.v_crm_deals, public.v_crm_tasks,
              public.v_crm_campaigns, public.v_crm_campaign_days from anon;
grant select on public.v_crm_leads, public.v_crm_accounts, public.v_crm_deals, public.v_crm_tasks,
                public.v_crm_campaigns, public.v_crm_campaign_days to authenticated;
