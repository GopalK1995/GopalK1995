-- LAWSOME Growth CRM schema (Postgres / Supabase). NOT applied anywhere yet.
-- Review before running. All access via RLS; service role only in server jobs.
-- No real data: seed with synthetic rows only.

create extension if not exists pgcrypto;

-- ---------- enums ----------
create type user_role        as enum ('admin','marketer','viewer');
create type lead_stage       as enum ('new','contacted','demo_booked','demo_done','proposal','won','lost');
create type channel_kind     as enum ('email','linkedin','meta','organic','direct','referral','other');
create type consent_purpose  as enum ('demo_followup','marketing_email','whatsapp','analytics_cookies');
create type consent_action   as enum ('granted','withdrawn','erasure_requested','erasure_completed');
create type integration_status as enum ('connected','mock','csv_only','error','not_configured');
create type sync_status      as enum ('running','success','partial','failed');
create type backup_status    as enum ('success','failed','missing','unknown');
create type task_status      as enum ('open','done','snoozed');

-- ---------- users (CRM staff, not leads) ----------
create table users (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  email       text not null unique,
  role        user_role not null default 'viewer',
  created_at  timestamptz not null default now()
);

-- ---------- campaigns ----------
create table campaigns (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  channel       channel_kind not null,
  utm_source    text not null,
  utm_medium    text not null,
  utm_campaign  text not null unique,      -- join key to leads.utm_campaign
  audience      text,                       -- free text target audience
  objective     text,
  starts_on     date,
  ends_on       date,
  budget_inr    numeric(12,2),
  owner_id      uuid references users(id),
  is_synthetic  boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Daily platform metrics per campaign. Source: API sync or CSV import.
create table campaign_daily_metrics (
  campaign_id   uuid not null references campaigns(id) on delete cascade,
  day           date not null,
  spend_inr     numeric(12,2) not null default 0,
  impressions   integer not null default 0,   -- email: delivered
  reach         integer not null default 0,   -- email: unique recipients
  clicks        integer not null default 0,
  platform_leads integer not null default 0,  -- leads claimed by the platform (e.g. LinkedIn lead-gen form)
  source        text not null default 'csv',  -- 'api' | 'csv' | 'manual' | 'mock'
  imported_at   timestamptz not null default now(),
  primary key (campaign_id, day)
);

-- ---------- leads ----------
create table leads (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  email           text not null,
  phone           text,
  organisation    text not null,
  role            text,                       -- matches landing form ROLES
  firm_size       text,                       -- '1-5','6-20','21-50','50+' (enriched by owner)
  city            text,
  state           text,
  practice_area   text,
  personal_email  boolean not null default false,
  stage           lead_stage not null default 'new',
  owner_id        uuid references users(id),
  campaign_id     uuid references campaigns(id),
  first_touch_channel channel_kind,
  first_touch_campaign text,                  -- utm_campaign at first visit
  last_touch_channel  channel_kind,
  last_touch_campaign text,
  utm_source      text, utm_medium text, utm_campaign text, utm_term text, utm_content text,
  source          text not null default 'lawsome-landing',
  consent_demo_followup boolean not null default false, -- denormalised from consent_log
  ai_summary      text,                       -- AI draft; always shown beside source timeline
  ai_summary_at   timestamptz,
  score           smallint,                   -- rule-based, see docs
  lost_reason     text,
  first_response_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,                -- soft delete before erasure job
  is_synthetic    boolean not null default false
);
create unique index leads_email_live on leads (lower(email)) where deleted_at is null;
create index leads_stage on leads (stage) where deleted_at is null;
create index leads_campaign on leads (utm_campaign);
create index leads_created on leads (created_at);

-- Every funnel event / CRM action. event_name matches landing app track.ts plus CRM events.
create table lead_events (
  id          bigint generated always as identity primary key,
  lead_id     uuid references leads(id) on delete cascade,   -- null for anonymous visitors
  anon_id     text,                                          -- consented first-party id
  event_name  text not null,  -- page_view|cta_click|form_start|form_submit|demo_booked|tour_play|demo_done|stage_changed|email_sent|call_logged|whatsapp_logged|note
  utm_source  text, utm_medium text, utm_campaign text,
  path        text,
  props       jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);
create index lead_events_name_time on lead_events (event_name, occurred_at);
create index lead_events_lead on lead_events (lead_id, occurred_at);

-- ---------- GA4 daily snapshot (Data API runReport, once a day) ----------
create table ga4_daily (
  day               date not null,
  channel_group     text not null,          -- sessionDefaultChannelGroup
  source_medium     text not null default '',
  device_category   text not null default '',
  country           text not null default '',
  region            text not null default '',
  landing_page      text not null default '',
  sessions          integer not null default 0,
  engaged_sessions  integer not null default 0,
  total_users       integer not null default 0,
  new_users         integer not null default 0,
  avg_engagement_secs numeric(8,2),
  key_events        integer not null default 0,
  primary key (day, channel_group, source_medium, device_category, country, region, landing_page)
);

-- ---------- integrations and syncs ----------
create table integrations (
  key           text primary key,           -- ga4|linkedin|meta|email|whatsapp|webhook|supabase
  label         text not null,
  status        integration_status not null default 'not_configured',
  is_mock       boolean not null default false,
  config_ref    text,                       -- name of secret in env/vault. NEVER the secret.
  last_sync_at  timestamptz,
  last_error    text,
  notes         text
);

create table sync_runs (
  id              bigint generated always as identity primary key,
  integration_key text not null references integrations(key),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          sync_status not null default 'running',
  rows_in         integer not null default 0,
  rows_rejected   integer not null default 0,
  error           text
);
create index sync_runs_key_time on sync_runs (integration_key, started_at desc);

-- ---------- backup monitoring ----------
create table backup_checks (
  id              bigint generated always as identity primary key,
  checked_at      timestamptz not null default now(),
  check_kind      text not null,            -- 'supabase_daily'|'logical_dump'|'restore_drill'|'row_count'
  status          backup_status not null,
  backup_taken_at timestamptz,              -- timestamp of the backup itself
  size_bytes      bigint,
  retention_days  smallint,
  pitr_enabled    boolean,
  location        text,                     -- label only, e.g. 'supabase-managed' / 'r2:bucket-name'
  row_counts      jsonb,                    -- {"leads":123,...} at dump time
  detail          text
);
create index backup_checks_time on backup_checks (checked_at desc);

create table backup_alert_rules (
  id          serial primary key,
  name        text not null,
  condition   text not null,                -- human-readable, e.g. 'no success in 26h'
  max_age_hours integer,
  notify_to   text not null,                -- role or channel label, not a secret
  enabled     boolean not null default true
);

-- ---------- tasks ----------
create table tasks (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid references leads(id) on delete cascade,
  title        text not null,
  kind         text not null default 'follow_up',  -- first_response|follow_up|demo_prep|other
  assignee_id  uuid references users(id),
  due_at       timestamptz not null,
  status       task_status not null default 'open',
  completed_at timestamptz,
  created_at   timestamptz not null default now()
);
create index tasks_due on tasks (status, due_at);

-- ---------- consent and privacy (DPDP) ----------
create table consent_log (
  id            bigint generated always as identity primary key,
  lead_id       uuid references leads(id) on delete set null,
  subject_ref   text not null,              -- hash of email, survives erasure of the lead row
  purpose       consent_purpose not null,
  action        consent_action not null,
  notice_version text not null,             -- version of privacy notice shown
  captured_via  text not null,              -- 'landing_form'|'cookie_banner'|'manual'|'request'
  occurred_at   timestamptz not null default now(),
  note          text
);
create index consent_subject on consent_log (subject_ref, occurred_at);

-- ---------- views used by screens (formulas documented in 02-screens-and-metrics.md) ----------
create view v_funnel_daily as
select date_trunc('day', occurred_at)::date as day,
       event_name,
       count(*) as events,
       count(distinct coalesce(lead_id::text, anon_id)) as people
from lead_events
group by 1, 2;

create view v_campaign_perf as
select c.id, c.name, c.channel,
       coalesce(sum(m.spend_inr),0)  as spend_inr,
       coalesce(sum(m.reach),0)      as reach,
       coalesce(sum(m.clicks),0)     as clicks,
       coalesce(sum(m.impressions),0) as impressions,
       (select count(*) from leads l where l.campaign_id = c.id and l.deleted_at is null) as leads,
       (select count(*) from leads l where l.campaign_id = c.id and l.deleted_at is null
          and l.stage in ('demo_booked','demo_done','proposal','won')) as demos_booked
from campaigns c
left join campaign_daily_metrics m on m.campaign_id = c.id
group by c.id;

-- ---------- RLS (enable and policy stubs; tighten before go-live) ----------
alter table users enable row level security;
alter table campaigns enable row level security;
alter table campaign_daily_metrics enable row level security;
alter table leads enable row level security;
alter table lead_events enable row level security;
alter table ga4_daily enable row level security;
alter table integrations enable row level security;
alter table sync_runs enable row level security;
alter table backup_checks enable row level security;
alter table backup_alert_rules enable row level security;
alter table tasks enable row level security;
alter table consent_log enable row level security;

create or replace function is_crm_staff() returns boolean language sql stable as
$$ select exists (select 1 from users u where u.id = auth.uid()) $$;

create policy staff_read on leads for select using (is_crm_staff());
create policy staff_write on leads for update using (is_crm_staff());
create policy staff_read on lead_events for select using (is_crm_staff());
create policy staff_read on campaigns for select using (is_crm_staff());
create policy staff_read on campaign_daily_metrics for select using (is_crm_staff());
create policy staff_read on ga4_daily for select using (is_crm_staff());
create policy staff_read on integrations for select using (is_crm_staff());
create policy staff_read on sync_runs for select using (is_crm_staff());
create policy staff_read on backup_checks for select using (is_crm_staff());
create policy staff_read on backup_alert_rules for select using (is_crm_staff());
create policy staff_all on tasks for all using (is_crm_staff());
create policy staff_read on consent_log for select using (is_crm_staff());
create policy self_read on users for select using (id = auth.uid());
-- Inserts into leads/lead_events/consent_log come from the landing app via the service role.
