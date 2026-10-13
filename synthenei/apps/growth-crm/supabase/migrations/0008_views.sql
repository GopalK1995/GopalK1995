-- 0008 aggregate views, workspace-scoped. They run as the view owner on purpose (Viewers read dashboards
-- without row access to leads) and filter inside by workspace membership AND role. No personal data except
-- the masked directory. Sales reps get no rows from team-level views and only their own scorecard row.
-- The Supabase advisor flags these as security_definer_view; accepted and documented (README).

create view public.v_funnel_daily with (security_barrier = true) as
select e.workspace_id,
       (e.occurred_at at time zone 'Asia/Kolkata')::date as day,
       e.event_name,
       count(*) as events,
       count(distinct coalesce(e.lead_id::text, e.anon_id)) as people
  from public.lead_events e
 where e.workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data','viewer'))
 group by 1, 2, 3;

create view public.v_campaign_perf with (security_barrier = true) as
with allowed as (
  select public.role_ws_ids('owner','sales_manager','marketing','data','viewer') as ws
), m as (
  select campaign_id, sum(spend_inr) spend_inr, sum(reach) reach, sum(impressions) impressions,
         sum(clicks) clicks, sum(reactions + comments + shares) interactions, sum(opens) opens,
         sum(platform_leads) platform_leads
    from public.campaign_daily_metrics
   where workspace_id in (select ws from allowed)
   group by campaign_id
), l as (
  select ld.workspace_id, ld.first_touch_campaign as utm_campaign, count(*) leads
    from public.leads ld
   where ld.workspace_id in (select ws from allowed) and ld.deleted_at is null
   group by 1, 2
), d as (
  select ld.workspace_id, ld.first_touch_campaign as utm_campaign,
         count(distinct dl.id) filter (where exists (select 1 from public.deal_stage_history h
              join public.pipeline_stages s on s.id = h.to_stage_id
             where h.deal_id = dl.id and s.position >= (select s2.position from public.pipeline_stages s2
                    where s2.workspace_id = dl.workspace_id and s2.key = 'demo_scheduled')
               and not s.is_lost)) as demos,
         count(*) filter (where dl.won_at is not null) as won_deals,
         coalesce(sum(dl.value_inr) filter (where dl.won_at is not null), 0) as revenue_inr
    from public.deals dl join public.leads ld on ld.id = dl.lead_id
   where dl.workspace_id in (select ws from allowed) and dl.deleted_at is null
   group by 1, 2
)
select c.workspace_id, c.id as campaign_id, c.name, c.channel, c.status, c.utm_campaign,
       coalesce(m.spend_inr,0) spend_inr, coalesce(m.reach,0) reach, coalesce(m.impressions,0) impressions,
       coalesce(m.clicks,0) clicks, coalesce(m.interactions,0) interactions, coalesce(m.platform_leads,0) platform_leads,
       coalesce(l.leads,0) leads, coalesce(d.demos,0) demos, coalesce(d.won_deals,0) won_deals,
       coalesce(d.revenue_inr,0) revenue_inr,
       round(m.clicks::numeric / nullif(m.impressions,0), 4)                         as ctr,               -- M7
       round(m.spend_inr / nullif(l.leads,0), 2)                                     as cpl_inr,           -- M9
       round(m.spend_inr / nullif(d.demos,0), 2)                                     as cost_per_demo_inr, -- M11
       round(coalesce(l.leads,0)::numeric / nullif(m.clicks,0), 4)                   as click_to_lead,     -- M47
       round((m.clicks + m.interactions + case when c.channel = 'email' then m.opens else 0 end)::numeric
             / nullif(m.impressions,0), 4)                                           as engagement_rate,   -- M46
       round(d.revenue_inr / nullif(m.spend_inr,0), 2)                               as roas,              -- M43
       coalesce(m.platform_leads,0) - coalesce(l.leads,0)                            as platform_crm_gap   -- M13
  from public.campaigns c
  left join m on m.campaign_id = c.id
  left join l on l.workspace_id = c.workspace_id and l.utm_campaign = c.utm_campaign
  left join d on d.workspace_id = c.workspace_id and d.utm_campaign = c.utm_campaign
 where c.workspace_id in (select ws from allowed);

-- M45 reach profile: 5 axes normalised 0-100 within each workspace
create view public.v_campaign_reach_profile with (security_barrier = true) as
select p.workspace_id, p.campaign_id, p.name, p.channel,
       round(100.0 * p.reach / nullif(max(p.reach) over w, 0))::int                         as axis_reach,
       round(100.0 * p.engagement_rate / nullif(max(p.engagement_rate) over w, 0))::int     as axis_engagement,
       round(100.0 * p.ctr / nullif(max(p.ctr) over w, 0))::int                             as axis_ctr,
       round(100.0 * p.click_to_lead / nullif(max(p.click_to_lead) over w, 0))::int         as axis_lead_rate,
       case when p.spend_inr = 0 and p.leads > 0 then 100
            when p.leads = 0 then 0
            else coalesce(round(100.0 * (min(p.cpl_inr) over w) / nullif(p.cpl_inr, 0))::int, 0) end as axis_cost_efficiency
  from public.v_campaign_perf p
window w as (partition by p.workspace_id);

create view public.v_pipeline_summary with (security_barrier = true) as
select s.workspace_id, s.id as stage_id, s.key, s.label, s.position, s.probability,
       count(d.id) as deals,
       coalesce(sum(d.value_inr), 0) as value_inr,                                              -- M34
       round(coalesce(sum(d.value_inr * s.probability / 100.0), 0), 2) as weighted_value_inr,   -- M35
       count(d.id) filter (where now() - d.stage_entered_at > make_interval(days => s.max_days)) as stuck_deals -- M41
  from public.pipeline_stages s
  left join public.deals d on d.stage_id = s.id and d.deleted_at is null
 where s.workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data','viewer'))
 group by s.workspace_id, s.id;

-- Rep scorecard, current month (IST), per workspace. Reps see only their own row.
create view public.v_rep_scorecard with (security_barrier = true) as
with bounds as (
  select date_trunc('month', now() at time zone 'Asia/Kolkata')::date as m
)
select ms.workspace_id, ms.user_id as rep_id, p.full_name,
       (select count(*) from public.leads l where l.workspace_id = ms.workspace_id and l.owner_id = ms.user_id
          and l.deleted_at is null and l.status not in ('disqualified','converted')) as open_leads,
       (select count(*) from public.leads l where l.workspace_id = ms.workspace_id and l.owner_id = ms.user_id
          and l.created_at >= (select m from bounds)) as leads_this_month,
       (select round(100.0 * count(*) filter (where l.first_response_at - l.created_at
                   <= make_interval(mins => w.sla_first_response_mins)) / nullif(count(*),0), 1)
          from public.leads l where l.workspace_id = ms.workspace_id and l.owner_id = ms.user_id
           and l.created_at >= now() - interval '30 days') as sla_pct_30d,
       (select count(*) from public.activities a where a.workspace_id = ms.workspace_id and a.owner_id = ms.user_id
          and a.kind = 'meeting' and a.meeting_type = 'demo' and a.done_at >= (select m from bounds)) as demos_done,
       (select coalesce(sum(d.value_inr),0) from public.deals d where d.workspace_id = ms.workspace_id
          and d.owner_id = ms.user_id and d.won_at >= (select m from bounds)) as won_value_inr,
       st.target_demos, st.won_value_inr as target_won_inr,
       round(100.0 * (select coalesce(sum(d.value_inr),0) from public.deals d where d.workspace_id = ms.workspace_id
          and d.owner_id = ms.user_id and d.won_at >= (select m from bounds)) / nullif(st.won_value_inr,0), 1) as attainment_pct -- M38
  from public.memberships ms
  join public.workspaces w on w.id = ms.workspace_id
  left join public.profiles p on p.id = ms.user_id
  left join public.sales_targets st on st.workspace_id = ms.workspace_id and st.rep_id = ms.user_id
                                   and st.month = (select m from bounds)
 where ms.role = 'sales_rep' and ms.is_active
   and (ms.workspace_id in (select public.role_ws_ids('owner','sales_manager','viewer'))
        or (ms.user_id = (select auth.uid()) and ms.workspace_id in (select public.member_ws_ids())));

-- Masked lead directory for viewers (and anyone needing counts without PII)
create view public.v_leads_masked with (security_barrier = true) as
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

create view public.v_backup_latest with (security_barrier = true) as
select distinct on (b.workspace_id, b.check_kind) b.workspace_id, b.check_kind, b.status, b.checked_at,
       b.backup_taken_at, b.size_bytes, b.retention_days, b.pitr_enabled, b.location,
       extract(epoch from now() - b.backup_taken_at) / 3600 as age_hours   -- M24
  from public.backup_checks b
 where b.status = 'success'
   and ((b.workspace_id is null and exists (select 1 from public.role_ws_ids('owner','sales_manager','data')))
        or b.workspace_id in (select public.role_ws_ids('owner','sales_manager','data')))
 order by b.workspace_id, b.check_kind, b.checked_at desc;

create view public.v_sync_freshness with (security_barrier = true) as
select i.workspace_id, i.provider, i.label, i.category, i.status, i.last_sync_at,
       extract(epoch from now() - i.last_sync_at) / 3600 as hours_since_sync,               -- M27
       (select count(*) filter (where r.status = 'failed')::numeric / nullif(count(*),0)
          from public.sync_runs r where r.integration_id = i.id
           and r.started_at > now() - interval '7 days') as error_rate_7d                   -- M56
  from public.integrations i
 where i.workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data'));
