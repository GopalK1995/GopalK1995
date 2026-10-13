-- =====================================================================
-- Growth CRM schema (multi-tenant, white-label). Postgres 15+ / Supabase. Validated 2026-10-13 on local PG 16
-- with a Supabase stub (auth.users, auth.uid(), anon/authenticated roles): applies cleanly; RLS, intake,
-- invitation, assignment and stage triggers exercised. Not applied to any remote DB by the spec agent.
-- Spec: synthenei/03-projects/growth-crm/03-product-spec.md (sections 6, 8, 10).
--
-- Model:   one database, tenant_id on every business row. RLS on EVERY table, policies by
--          tenant + role. Role/tenant come from public.profiles via SECURITY DEFINER helpers
--          (no recursive RLS on profiles).
-- Roles:   owner | sales_manager | sales_rep | marketing | data | viewer
-- Intake:  the landing page calls public.submit_lead(...) / public.track_event(...) with the
--          anon key (SECURITY DEFINER, validated, throttled). No service-role key on the client.
-- Writes by integrations/cron use the service role (bypasses RLS) inside Edge Functions only.
-- No secrets and no real personal data in this file. Seed with synthetic rows only.
-- =====================================================================

-- ---------- 0. Pre-existing landing table guard ----------
-- lawsome-landing/supabase/leads.sql created a single-tenant public.leads without tenant_id.
-- If that table exists, keep its rows by renaming it; migrate them later with an explicit script.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'leads')
     and not exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'leads' and column_name = 'tenant_id') then
    alter table public.leads rename to landing_leads_legacy;
  end if;
end $$;

-- ---------- 1. Enums ----------
create type public.app_role           as enum ('owner','sales_manager','sales_rep','marketing','data','viewer');
create type public.lead_status        as enum ('new','working','nurturing','qualified','disqualified','converted');
create type public.channel_kind       as enum ('email','linkedin','meta','google_ads','whatsapp','organic','direct','referral','event','other');
create type public.activity_kind      as enum ('call','whatsapp','email','meeting','note');
create type public.task_status        as enum ('open','done','snoozed','cancelled');
create type public.customer_status    as enum ('prospect','trial','customer','churned');
create type public.consent_purpose    as enum ('demo_followup','marketing_email','whatsapp','analytics_cookies','ai_processing');
create type public.consent_action     as enum ('granted','withdrawn','erasure_requested','erasure_completed');
create type public.integration_status as enum ('connected','showcase','needs_attention','error','not_configured');
create type public.sync_status        as enum ('running','success','partial','failed');
create type public.backup_status      as enum ('success','failed','missing','unknown');
create type public.conv_channel       as enum ('whatsapp','email','linkedin');
create type public.msg_direction      as enum ('inbound','outbound');
create type public.msg_status         as enum ('queued','simulated','sent','delivered','read','failed','received');
create type public.ai_feature         as enum ('lead_score','summary','next_best_action','reply_draft','campaign_digest','ask_crm');
create type public.ai_status          as enum ('draft','accepted','edited','dismissed');

-- ---------- 2. Tenancy, users, invitations ----------
create table public.tenants (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name               text not null,
  is_demo            boolean not null default false,
  -- white-label branding tokens
  brand_name         text not null,
  brand_logo_url     text,
  brand_logo_dark_url text,
  brand_favicon_url  text,
  brand_primary      text not null default '#1D5FBF' check (brand_primary ~ '^#[0-9A-Fa-f]{6}$'),
  brand_accent       text not null default '#0F8B8D' check (brand_accent  ~ '^#[0-9A-Fa-f]{6}$'),
  email_sender_name  text,
  support_email      text,
  custom_domain      text unique,
  -- business settings
  timezone           text not null default 'Asia/Kolkata',
  currency           text not null default 'INR',
  sla_first_response_mins integer not null default 120 check (sla_first_response_mins between 5 and 2880),
  business_hours     jsonb not null default '{"days":[1,2,3,4,5,6],"start":"10:00","end":"19:00"}',
  holidays           date[] not null default '{}',
  lead_intake_enabled boolean not null default true,
  ai_enabled         jsonb not null default '{}',     -- {"summary":false,...}; all off by default
  ai_monthly_call_cap integer not null default 2000,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  full_name   text not null,
  email       text not null,
  phone       text,
  role        public.app_role not null default 'viewer',
  is_active   boolean not null default true,
  language    text not null default 'en' check (language in ('en','ta')),
  last_seen_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index profiles_tenant_role on public.profiles (tenant_id, role);

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        public.app_role not null,
  territory_districts text[] not null default '{}',
  invited_by  uuid references public.profiles(id) on delete set null,
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index invitations_pending_email on public.invitations (lower(email)) where accepted_at is null;

-- ---------- 3. RLS helper functions (SECURITY DEFINER, no recursion) ----------
create or replace function public.current_tenant_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.tenant_id from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function public.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_app_role() = any(roles), false)
$$;

-- ---------- 4. Sales configuration ----------
create table public.pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  key         text not null,                 -- discovery|demo_scheduled|demo_done|proposal|negotiation|won|lost
  label       text not null,
  position    smallint not null,
  probability smallint not null check (probability between 0 and 100),
  max_days    smallint not null default 14,  -- "stuck" threshold (M41)
  is_won      boolean not null default false,
  is_lost     boolean not null default false,
  unique (tenant_id, key),
  unique (tenant_id, position),
  check (not (is_won and is_lost))
);

create table public.territories (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  district    text not null,                 -- Tamil Nadu district, e.g. 'Madurai'
  rep_id      uuid not null references public.profiles(id) on delete cascade,
  primary key (tenant_id, district)
);

create table public.sales_targets (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  rep_id         uuid not null references public.profiles(id) on delete cascade,
  month          date not null check (extract(day from month) = 1),
  target_demos   integer not null default 0,
  won_value_inr  numeric(14,2) not null default 0,
  unique (tenant_id, rep_id, month)
);

-- ---------- 5. Accounts (law firms) and contacts ----------
create table public.accounts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  name            text not null,              -- e.g. 'Vaigai Advocates & Associates' (fictional)
  city            text,
  district        text,
  state           text not null default 'Tamil Nadu',
  address_line    text,
  court_focus     text[] not null default '{}',  -- 'madras_hc','madurai_bench','district','tribunal','consumer'
  practice_areas  text[] not null default '{}',  -- 'civil','criminal','family','mact','ni_138','writ','commercial','ip','tax','labour'
  size_band       text check (size_band in ('solo','2-5','6-20','21-50','50+')),
  lawyers_count   integer check (lawyers_count >= 0),
  clerks_count    integer check (clerks_count >= 0),
  sites           jsonb not null default '[]',   -- [{"label":"Egmore HQ","city":"Chennai"},...]
  sites_count     integer generated always as (jsonb_array_length(sites)) stored,
  current_tools   text,                          -- 'Excel + WhatsApp groups'
  website         text,
  customer_status public.customer_status not null default 'prospect',
  owner_id        uuid references public.profiles(id) on delete set null,
  external_ids    jsonb not null default '{}',   -- {"zoho":"..."}
  external_data   jsonb not null default '{}',
  is_synthetic    boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index accounts_tenant_district on public.accounts (tenant_id, district) where deleted_at is null;
create unique index accounts_tenant_name_city on public.accounts (tenant_id, lower(name), lower(coalesce(city,''))) where deleted_at is null;

create table public.contacts (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  account_id       uuid references public.accounts(id) on delete set null,
  full_name        text not null,
  role_title       text,                      -- 'Managing partner','Senior advocate','Associate','Office manager'
  is_decision_maker boolean not null default false,
  email            text,
  phone            text,                      -- E.164, e.g. +9198xxxxxxxx (synthetic in seeds)
  preferred_language text not null default 'en' check (preferred_language in ('en','ta')),
  owner_id         uuid references public.profiles(id) on delete set null,
  external_ids     jsonb not null default '{}',
  is_synthetic     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index contacts_tenant_account on public.contacts (tenant_id, account_id);
create index contacts_tenant_phone on public.contacts (tenant_id, phone) where deleted_at is null;

-- ---------- 6. Campaigns ----------
create table public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null,
  channel       public.channel_kind not null,
  status        text not null default 'draft' check (status in ('draft','active','paused','ended','archived')),
  objective     text,
  utm_source    text not null,
  utm_medium    text not null,
  utm_campaign  text not null,                -- {channel}_{district|statewide}_{theme}_{yyyymm}
  segment_id    uuid,
  starts_on     date,
  ends_on       date,
  budget_inr    numeric(14,2),
  owner_id      uuid references public.profiles(id) on delete set null,
  external_ids  jsonb not null default '{}',
  notes         text,
  is_synthetic  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, utm_campaign)
);

create table public.campaign_daily_metrics (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  campaign_id   uuid not null references public.campaigns(id) on delete cascade,
  day           date not null,
  spend_inr     numeric(14,2) not null default 0,
  impressions   integer not null default 0,   -- email: delivered
  reach         integer not null default 0,   -- email: unique recipients
  clicks        integer not null default 0,
  reactions     integer not null default 0,
  comments      integer not null default 0,
  shares        integer not null default 0,
  opens         integer not null default 0,   -- email, bot-filtered where available
  bounces       integer not null default 0,
  unsubscribes  integer not null default 0,
  platform_leads integer not null default 0,
  source        text not null default 'csv' check (source in ('api','csv','manual','mock')),
  imported_at   timestamptz not null default now(),
  primary key (campaign_id, day)
);
create index cdm_tenant_day on public.campaign_daily_metrics (tenant_id, day);

create table public.audience_segments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  is_icp      boolean not null default false,
  rules       jsonb not null default '[]',    -- [{"field":"district","op":"in","values":["Madurai","Trichy"]}]
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.campaigns add constraint campaigns_segment_fk
  foreign key (segment_id) references public.audience_segments(id) on delete set null;

-- ---------- 7. Leads and web/funnel events ----------
create table public.leads (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  full_name       text not null,
  email           text,
  phone           text,
  role_title      text,
  firm_name       text,
  account_id      uuid references public.accounts(id) on delete set null,
  contact_id      uuid references public.contacts(id) on delete set null,
  city            text,
  district        text,
  practice_area   text,
  personal_email  boolean not null default false,
  status          public.lead_status not null default 'new',
  disqualify_reason text,
  owner_id        uuid references public.profiles(id) on delete set null,
  assigned_at     timestamptz,
  campaign_id     uuid references public.campaigns(id) on delete set null,
  first_touch_channel  public.channel_kind,
  first_touch_campaign text,
  last_touch_channel   public.channel_kind,
  last_touch_campaign  text,
  utm             jsonb not null default '{}',  -- {source,medium,campaign,term,content}
  click_ids       jsonb not null default '{}',  -- {gclid,fbclid,li_fat_id}
  landing_path    text,
  source          text not null default 'landing',  -- landing|csv|manual|zoho|linkedin|meta|calendly|zapier
  consent_demo_followup boolean not null default false,  -- denormalised from consent_log
  consent_whatsapp      boolean not null default false,
  consent_marketing     boolean not null default false,
  score           smallint check (score between 0 and 100),
  score_factors   jsonb not null default '[]',  -- [{"factor":"role_managing_partner","points":30}]
  first_response_at timestamptz,
  last_touch_at   timestamptz,
  next_step_at    timestamptz,
  external_ids    jsonb not null default '{}',
  is_synthetic    boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create unique index leads_tenant_email_live on public.leads (tenant_id, lower(email)) where deleted_at is null and email is not null;
create index leads_tenant_owner_status on public.leads (tenant_id, owner_id, status) where deleted_at is null;
create index leads_tenant_created on public.leads (tenant_id, created_at desc);
create index leads_tenant_district on public.leads (tenant_id, district) where deleted_at is null;
create index leads_tenant_score on public.leads (tenant_id, score desc) where deleted_at is null;
create index leads_tenant_phone on public.leads (tenant_id, phone) where deleted_at is null;
create index leads_first_campaign on public.leads (tenant_id, first_touch_campaign);

create table public.lead_events (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  lead_id     uuid references public.leads(id) on delete cascade,   -- null for anonymous visitors
  anon_id     text,                                                 -- consented first-party id
  event_name  text not null,  -- page_view|cta_click|form_start|form_submit|tour_play|demo_booked|pricing_view|demo_done|stage_changed
  utm         jsonb not null default '{}',
  path        text,
  props       jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);
create index lead_events_tenant_name_time on public.lead_events (tenant_id, event_name, occurred_at);
create index lead_events_lead on public.lead_events (lead_id, occurred_at);
create index lead_events_anon on public.lead_events (tenant_id, anon_id) where anon_id is not null;

-- ---------- 8. Deals ----------
create table public.deals (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  name            text not null,              -- 'Rockfort Legal - Firm plan, 12 seats'
  account_id      uuid references public.accounts(id) on delete set null,
  primary_contact_id uuid references public.contacts(id) on delete set null,
  lead_id         uuid references public.leads(id) on delete set null,
  stage_id        uuid not null references public.pipeline_stages(id),
  stage_entered_at timestamptz not null default now(),
  value_inr       numeric(14,2) not null default 0 check (value_inr >= 0),
  seats           integer check (seats > 0),
  plan            text,                       -- placeholder until LAWSOME pricing is shared
  expected_close_on date,
  owner_id        uuid references public.profiles(id) on delete set null,
  next_step       text,
  next_step_at    timestamptz,
  objections      text[] not null default '{}',  -- ai_accuracy|data_security|price|training_time|ecourts_reliability|other
  lost_reason     text,
  competitor      text,
  won_at          timestamptz,
  lost_at         timestamptz,
  external_ids    jsonb not null default '{}',
  external_data   jsonb not null default '{}',
  is_synthetic    boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index deals_tenant_stage on public.deals (tenant_id, stage_id) where deleted_at is null;
create index deals_tenant_owner on public.deals (tenant_id, owner_id) where deleted_at is null;
create index deals_tenant_won on public.deals (tenant_id, won_at) where won_at is not null;

create table public.deal_stage_history (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  deal_id     uuid not null references public.deals(id) on delete cascade,
  from_stage_id uuid references public.pipeline_stages(id),
  to_stage_id uuid not null references public.pipeline_stages(id),
  changed_by  uuid references public.profiles(id) on delete set null,
  changed_at  timestamptz not null default now()
);
create index dsh_deal on public.deal_stage_history (deal_id, changed_at);
create index dsh_tenant_stage on public.deal_stage_history (tenant_id, to_stage_id, changed_at);

-- ---------- 9. Activities and tasks ----------
create table public.activities (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  kind          public.activity_kind not null,
  lead_id       uuid references public.leads(id) on delete cascade,
  contact_id    uuid references public.contacts(id) on delete set null,
  account_id    uuid references public.accounts(id) on delete set null,
  deal_id       uuid references public.deals(id) on delete set null,
  owner_id      uuid references public.profiles(id) on delete set null,  -- who logged / owns it
  direction     public.msg_direction,
  outcome       text,      -- call: connected|no_answer|busy|wrong_number|call_back_later
  meeting_type  text check (meeting_type in ('demo','discovery','follow_up','onboarding')),
  scheduled_at  timestamptz,
  duration_mins integer check (duration_mins >= 0),
  subject       text,
  body          text,
  done_at       timestamptz,
  source        text not null default 'manual',  -- manual|whatsapp_api|gmail|calendly|zoho|simulated
  created_at    timestamptz not null default now()
);
create index activities_tenant_lead on public.activities (tenant_id, lead_id, created_at desc);
create index activities_tenant_owner_time on public.activities (tenant_id, owner_id, created_at desc);
create index activities_demos on public.activities (tenant_id, scheduled_at) where kind = 'meeting';

create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  lead_id      uuid references public.leads(id) on delete cascade,
  deal_id      uuid references public.deals(id) on delete cascade,
  title        text not null,
  kind         text not null default 'follow_up'
               check (kind in ('first_response','call','whatsapp','email','follow_up','demo_prep','proposal','other')),
  priority     smallint not null default 2 check (priority between 1 and 3),
  assignee_id  uuid references public.profiles(id) on delete set null,
  created_by   uuid references public.profiles(id) on delete set null,
  due_at       timestamptz not null,
  status       public.task_status not null default 'open',
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index tasks_tenant_assignee_due on public.tasks (tenant_id, assignee_id, status, due_at);

-- ---------- 10. Inbox (conversations + messages; showcase until WhatsApp/Gmail connect) ----------
create table public.message_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  channel     public.conv_channel not null default 'whatsapp',
  name        text not null,                  -- 'demo_invite_ta'
  language    text not null default 'en' check (language in ('en','ta')),
  category    text not null default 'utility' check (category in ('marketing','utility','authentication')),
  body        text not null,                  -- 'Vanakkam {{1}}, ...'
  variables   text[] not null default '{}',
  approval_status text not null default 'showcase' check (approval_status in ('showcase','pending','approved','rejected')),
  unique (tenant_id, channel, name, language)
);

create table public.conversations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  channel       public.conv_channel not null,
  lead_id       uuid references public.leads(id) on delete set null,
  contact_id    uuid references public.contacts(id) on delete set null,
  assignee_id   uuid references public.profiles(id) on delete set null,
  external_thread_id text,
  status        text not null default 'open' check (status in ('open','closed')),
  last_inbound_at  timestamptz,               -- WhatsApp 24 h window starts here
  last_message_at  timestamptz,
  last_read_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index conversations_tenant_assignee on public.conversations (tenant_id, assignee_id, last_message_at desc);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction       public.msg_direction not null,
  status          public.msg_status not null default 'queued',
  template_id     uuid references public.message_templates(id) on delete set null,
  body            text,
  is_internal_note boolean not null default false,
  sent_by         uuid references public.profiles(id) on delete set null,
  external_id     text,
  ai_insight_id   uuid,                       -- set when sent from an AI draft
  created_at      timestamptz not null default now(),
  status_at       timestamptz
);
create index messages_conv_time on public.messages (conversation_id, created_at);

-- ---------- 11. Analytics ----------
create table public.ga4_daily (
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  day               date not null,
  channel_group     text not null,
  source_medium     text not null default '',
  device_category   text not null default '',
  city              text not null default '',
  landing_page      text not null default '',
  sessions          integer not null default 0,
  engaged_sessions  integer not null default 0,
  total_users       integer not null default 0,
  new_users         integer not null default 0,
  avg_engagement_secs numeric(8,2),
  key_events        integer not null default 0,
  source            text not null default 'mock' check (source in ('api','mock')),
  primary key (tenant_id, day, channel_group, source_medium, device_category, city, landing_page)
);

-- ---------- 12. Integrations ----------
create table public.integrations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  provider      text not null,   -- zoho_crm|whatsapp|linkedin|mailchimp|ga4|meta_ads|google_ads|gmail|outlook|calendly|calcom|slack|zapier|make|razorpay|landing|csv
  label         text not null,
  category      text not null check (category in ('crm','messaging','social_ads','email','analytics','calendar','payments','automation','notifications','internal')),
  direction     text not null check (direction in ('in','out','both')),
  status        public.integration_status not null default 'showcase',
  auth_method   text,
  config_ref    text,            -- NAME of a secret in Vault / env. Never the secret itself.
  settings      jsonb not null default '{}',
  last_sync_at  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, provider)
);

create table public.integration_field_maps (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  external_object text not null,   -- 'Deals'
  external_field text not null,    -- 'Stage'
  local_table    text not null,    -- 'deals'
  local_column   text not null,    -- 'stage_id'
  direction      text not null check (direction in ('in','out','both')),
  transform      text,             -- 'stage_key_map', 'e164_phone', 'inr_paise_to_rupees'
  conflict_owner text not null default 'crm' check (conflict_owner in ('crm','external','last_write')),
  sample_value   text,             -- synthetic sample only
  unique (integration_id, external_object, external_field)
);

create table public.sync_runs (
  id              bigint generated always as identity primary key,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  integration_id  uuid references public.integrations(id) on delete set null,
  kind            text not null default 'poll' check (kind in ('poll','webhook','csv','outbound','manual')),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          public.sync_status not null default 'running',
  rows_in         integer not null default 0,
  rows_out        integer not null default 0,
  rows_rejected   integer not null default 0,
  error           text,            -- no secrets, no PII
  payload_sample  jsonb,           -- truncated, PII-stripped
  started_by      uuid references public.profiles(id) on delete set null
);
create index sync_runs_tenant_time on public.sync_runs (tenant_id, integration_id, started_at desc);

-- ---------- 13. Backups (tenant_id null = project-wide check) ----------
create table public.backup_checks (
  id              bigint generated always as identity primary key,
  tenant_id       uuid references public.tenants(id) on delete cascade,
  checked_at      timestamptz not null default now(),
  check_kind      text not null check (check_kind in ('supabase_daily','logical_dump','restore_drill','row_count','heartbeat')),
  status          public.backup_status not null,
  backup_taken_at timestamptz,
  size_bytes      bigint,
  retention_days  smallint,
  pitr_enabled    boolean,
  location        text,            -- label only, e.g. 'offsite:crm-dumps'
  row_counts      jsonb,
  detail          text
);
create index backup_checks_time on public.backup_checks (check_kind, checked_at desc);

create table public.backup_alert_rules (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.tenants(id) on delete cascade,
  name          text not null,
  check_kind    text not null,
  condition     text not null,     -- 'no success in 26h'
  max_age_hours integer,
  max_size_drop_pct integer,
  notify_to     text not null,     -- role or channel label, not a secret
  enabled       boolean not null default true
);

-- ---------- 14. AI ----------
create table public.ai_insights (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  feature       public.ai_feature not null,
  user_id       uuid references public.profiles(id) on delete set null,   -- who requested / sees it
  lead_id       uuid references public.leads(id) on delete cascade,
  deal_id       uuid references public.deals(id) on delete cascade,
  campaign_id   uuid references public.campaigns(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  input_summary text,              -- 'Based on 14 events (3-11 Oct)'; never raw PII
  source_refs   jsonb not null default '[]',
  output        text not null,
  output_json   jsonb,
  model         text,
  status        public.ai_status not null default 'draft',
  feedback      text,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
create index ai_insights_tenant_feature on public.ai_insights (tenant_id, feature, created_at desc);
alter table public.messages add constraint messages_ai_fk
  foreign key (ai_insight_id) references public.ai_insights(id) on delete set null;

-- ---------- 15. Consent (DPDP) and audit ----------
create table public.consent_log (
  id             bigint generated always as identity primary key,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  lead_id        uuid references public.leads(id) on delete set null,
  subject_ref    text not null,    -- sha256 of lower(email) or phone; survives erasure
  purpose        public.consent_purpose not null,
  action         public.consent_action not null,
  notice_version text not null,
  captured_via   text not null check (captured_via in ('landing_form','cookie_banner','manual','request','whatsapp_optin','import','integration')),
  recorded_by    uuid references public.profiles(id) on delete set null,
  occurred_at    timestamptz not null default now(),
  note           text
);
create index consent_tenant_subject on public.consent_log (tenant_id, subject_ref, occurred_at);

create table public.audit_log (
  id          bigint generated always as identity primary key,
  tenant_id   uuid references public.tenants(id) on delete cascade,
  actor_id    uuid,                -- auth.uid(); null for service role / cron
  actor_label text,                -- 'user' | 'service' | 'integration:zoho'
  action      text not null check (action in ('insert','update','delete')),
  table_name  text not null,
  row_id      text,
  changes     jsonb,               -- {"col":{"old":..,"new":..}}
  occurred_at timestamptz not null default now()
);
create index audit_tenant_time on public.audit_log (tenant_id, occurred_at desc);
create index audit_row on public.audit_log (table_name, row_id);

-- =====================================================================
-- 16. Trigger functions
-- =====================================================================
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['tenants','profiles','accounts','contacts','campaigns','audience_segments',
                           'leads','deals','tasks','integrations'] loop
    execute format('create trigger trg_%1$s_updated before update on public.%1$I
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- Generic audit trigger (append-only audit_log).
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r     jsonb := coalesce(r_new, r_old);
  diff  jsonb;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value))
      into diff
      from jsonb_each(r_new) n join jsonb_each(r_old) o using (key)
     where n.value is distinct from o.value and n.key not in ('updated_at');
    if diff is null then return new; end if;
  elsif tg_op = 'INSERT' then diff := r_new;
  else diff := r_old;
  end if;
  insert into public.audit_log (tenant_id, actor_id, actor_label, action, table_name, row_id, changes)
  values (
    coalesce((r->>'tenant_id')::uuid, case when tg_table_name = 'tenants' then (r->>'id')::uuid end),
    auth.uid(),
    coalesce(nullif(current_setting('app.actor_label', true), ''), case when auth.uid() is null then 'service' else 'user' end),
    lower(tg_op), tg_table_name, r->>'id', diff);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['tenants','profiles','invitations','accounts','contacts','leads','deals',
                           'pipeline_stages','territories','integrations','integration_field_maps','consent_log'] loop
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- Privilege-escalation guard on profiles.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me public.app_role := public.current_app_role();
begin
  if auth.uid() is null then return new; end if;                 -- service role / SQL editor
  if new.tenant_id <> old.tenant_id or new.id <> old.id or new.email <> old.email then
    raise exception 'tenant, id and email cannot be changed here';
  end if;
  if new.role <> old.role or new.is_active <> old.is_active then
    if new.id = auth.uid() then
      raise exception 'you cannot change your own role or active status';
    elsif me = 'owner' then
      null;
    elsif me = 'sales_manager' and old.role in ('sales_rep','viewer') and new.role in ('sales_rep','viewer') then
      null;
    else
      raise exception 'not allowed to change role or status';
    end if;
  end if;
  return new;
end $$;
create trigger trg_profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- New auth user -> profile only if a pending, unexpired invitation exists.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv public.invitations;
begin
  select * into inv from public.invitations
   where lower(email) = lower(new.email) and accepted_at is null and expires_at > now()
   order by created_at desc limit 1;
  if inv.id is null then return new; end if;     -- no invite: no profile, no access
  insert into public.profiles (id, tenant_id, full_name, email, role)
  values (new.id, inv.tenant_id, coalesce(inv.full_name, split_part(new.email, '@', 1)), new.email, inv.role)
  on conflict (id) do nothing;
  insert into public.territories (tenant_id, district, rep_id)
  select inv.tenant_id, d, new.id from unnest(inv.territory_districts) d
  on conflict (tenant_id, district) do update set rep_id = excluded.rep_id;
  update public.invitations set accepted_at = now() where id = inv.id;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Lead auto-assignment by district territory + first-response task.
create or replace function public.lead_assign_on_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id is null and new.district is not null then
    select t.rep_id into new.owner_id
      from public.territories t join public.profiles p on p.id = t.rep_id and p.is_active
     where t.tenant_id = new.tenant_id and lower(t.district) = lower(new.district);
  end if;
  if new.owner_id is not null and new.assigned_at is null then new.assigned_at := now(); end if;
  return new;
end $$;
create trigger trg_leads_assign before insert on public.leads
  for each row execute function public.lead_assign_on_insert();

create or replace function public.lead_first_response_task() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sla int;
begin
  if new.owner_id is not null and new.first_response_at is null
     and (tg_op = 'INSERT' or old.owner_id is distinct from new.owner_id) then
    if tg_op = 'UPDATE' then new.assigned_at := now(); end if;
    select sla_first_response_mins into sla from public.tenants where id = new.tenant_id;
    -- Wall-clock due time; business-hours SLA (M14) is computed in the app/report layer.
    insert into public.tasks (tenant_id, lead_id, title, kind, priority, assignee_id, due_at)
    values (new.tenant_id, new.id, 'First response: ' || new.full_name, 'first_response', 1,
            new.owner_id, now() + make_interval(mins => coalesce(sla, 120)));
  end if;
  return new;
end $$;
create trigger trg_leads_first_task_ins after insert on public.leads
  for each row execute function public.lead_first_response_task();
create trigger trg_leads_first_task_upd before update of owner_id on public.leads
  for each row execute function public.lead_first_response_task();

-- Logging an outbound touch sets first_response_at / last_touch_at on the lead.
create or replace function public.activity_touch_lead() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.lead_id is not null and new.kind in ('call','whatsapp','email','meeting')
     and coalesce(new.direction, 'outbound') = 'outbound' then
    update public.leads
       set first_response_at = coalesce(first_response_at, new.created_at),
           last_touch_at = greatest(coalesce(last_touch_at, new.created_at), new.created_at),
           status = case when status = 'new' then 'working'::public.lead_status else status end
     where id = new.lead_id and tenant_id = new.tenant_id;
    update public.tasks set status = 'done', completed_at = now()
     where lead_id = new.lead_id and kind = 'first_response' and status = 'open';
  end if;
  return new;
end $$;
create trigger trg_activities_touch after insert on public.activities
  for each row execute function public.activity_touch_lead();

-- Deal stage bookkeeping + history (feeds M36, M41).
create or replace function public.deal_stage_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare st public.pipeline_stages;
begin
  select * into st from public.pipeline_stages where id = new.stage_id;
  if st.tenant_id <> new.tenant_id then raise exception 'stage belongs to another tenant'; end if;
  if tg_op = 'INSERT' or new.stage_id <> old.stage_id then
    new.stage_entered_at := now();
    new.won_at  := case when st.is_won  then coalesce(new.won_at, now())  end;
    new.lost_at := case when st.is_lost then coalesce(new.lost_at, now()) end;
    if st.is_won and (new.value_inr <= 0 or new.seats is null) then
      raise exception 'won deals need value_inr > 0 and seats';
    end if;
    if st.is_lost and new.lost_reason is null then
      raise exception 'lost deals need lost_reason';
    end if;
  end if;
  return new;
end $$;
create trigger trg_deals_stage before insert or update of stage_id on public.deals
  for each row execute function public.deal_stage_change();

create or replace function public.deal_stage_history_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.stage_id <> old.stage_id then
    insert into public.deal_stage_history (tenant_id, deal_id, from_stage_id, to_stage_id, changed_by)
    values (new.tenant_id, new.id, case when tg_op = 'UPDATE' then old.stage_id end, new.stage_id, auth.uid());
  end if;
  return new;
end $$;
create trigger trg_deals_history after insert or update of stage_id on public.deals
  for each row execute function public.deal_stage_history_write();

-- =====================================================================
-- 17. Anonymous-safe intake (landing page, anon key)
-- =====================================================================
-- Public branding for the login page (no personal data).
create or replace function public.tenant_branding(p_slug text default null, p_domain text default null)
returns table (tenant_id uuid, slug text, brand_name text, brand_logo_url text, brand_logo_dark_url text,
               brand_favicon_url text, brand_primary text, brand_accent text, support_email text, is_demo boolean)
language sql stable security definer set search_path = '' as $$
  select t.id, t.slug, t.brand_name, t.brand_logo_url, t.brand_logo_dark_url, t.brand_favicon_url,
         t.brand_primary, t.brand_accent, t.support_email, t.is_demo
    from public.tenants t
   where (p_slug is not null and t.slug = p_slug) or (p_domain is not null and t.custom_domain = lower(p_domain))
   limit 1
$$;

create or replace function public.submit_lead(
  p_tenant_slug        text,
  p_full_name          text,
  p_email              text,
  p_phone              text default null,
  p_firm_name          text default null,
  p_role_title         text default null,
  p_city               text default null,
  p_district           text default null,
  p_practice_area      text default null,
  p_consent_followup   boolean default false,
  p_consent_whatsapp   boolean default false,
  p_consent_marketing  boolean default false,
  p_notice_version     text default 'v1',
  p_utm                jsonb default '{}',
  p_click_ids          jsonb default '{}',
  p_anon_id            text default null,
  p_landing_path       text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t         public.tenants;
  v_email   text := lower(trim(p_email));
  v_phone   text := nullif(regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g'), '');
  v_subject text;
  v_lead    uuid;
  v_account uuid;
  v_campaign uuid;
  v_channel public.channel_kind;
  v_personal boolean;
begin
  select * into t from public.tenants where slug = p_tenant_slug and lead_intake_enabled;
  if t.id is null then raise exception 'unknown tenant' using errcode = '22023'; end if;

  -- validation
  if p_full_name is null or length(trim(p_full_name)) not between 2 and 120 then
    raise exception 'invalid name' using errcode = '22023'; end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'invalid email' using errcode = '22023'; end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{10,15}$' then
    raise exception 'invalid phone' using errcode = '22023'; end if;
  if not coalesce(p_consent_followup, false) then
    raise exception 'consent for demo follow-up is required' using errcode = '22023'; end if;
  if pg_column_size(p_utm) > 2000 or pg_column_size(p_click_ids) > 1000 then
    raise exception 'payload too large' using errcode = '22023'; end if;

  -- throttle: 5 submissions per email per hour, 300 per tenant per 10 minutes
  if (select count(*) from public.lead_events e join public.leads l on l.id = e.lead_id
       where l.tenant_id = t.id and lower(l.email) = v_email and e.event_name = 'form_submit'
         and e.occurred_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.lead_events e
          where e.tenant_id = t.id and e.event_name = 'form_submit'
            and e.occurred_at > now() - interval '10 minutes') >= 300 then
    raise exception 'too many submissions, try later' using errcode = '54000';
  end if;

  v_subject  := encode(sha256(convert_to(v_email, 'UTF8')), 'hex');
  v_personal := split_part(v_email, '@', 2) in ('gmail.com','yahoo.com','yahoo.co.in','outlook.com','hotmail.com','rediffmail.com','icloud.com','proton.me');
  v_channel  := case lower(coalesce(p_utm->>'source',''))
                  when 'linkedin' then 'linkedin' when 'facebook' then 'meta' when 'instagram' then 'meta'
                  when 'meta' then 'meta' when 'google' then
                    case when lower(coalesce(p_utm->>'medium','')) in ('cpc','paid','ppc') then 'google_ads' else 'organic' end
                  when 'whatsapp' then 'whatsapp' when '' then 'direct'
                  else case when lower(coalesce(p_utm->>'medium','')) = 'email' then 'email' else 'other' end
                end::public.channel_kind;
  select id into v_campaign from public.campaigns where tenant_id = t.id and utm_campaign = p_utm->>'campaign';

  if p_firm_name is not null and length(trim(p_firm_name)) > 1 then
    select id into v_account from public.accounts
     where tenant_id = t.id and lower(name) = lower(trim(p_firm_name))
       and lower(coalesce(city,'')) = lower(coalesce(trim(p_city),'')) and deleted_at is null;
    if v_account is null then
      insert into public.accounts (tenant_id, name, city, district)
      values (t.id, trim(p_firm_name), nullif(trim(p_city),''), nullif(trim(p_district),''))
      returning id into v_account;
    end if;
  end if;

  select id into v_lead from public.leads
   where tenant_id = t.id and lower(email) = v_email and deleted_at is null;

  if v_lead is null then
    insert into public.leads (tenant_id, full_name, email, phone, role_title, firm_name, account_id, city, district,
                              practice_area, personal_email, campaign_id, first_touch_channel, first_touch_campaign,
                              last_touch_channel, last_touch_campaign, utm, click_ids, landing_path, source,
                              consent_demo_followup, consent_whatsapp, consent_marketing)
    values (t.id, trim(p_full_name), v_email, v_phone, p_role_title, nullif(trim(p_firm_name),''), v_account,
            nullif(trim(p_city),''), nullif(trim(p_district),''), p_practice_area, v_personal, v_campaign,
            v_channel, p_utm->>'campaign', v_channel, p_utm->>'campaign', coalesce(p_utm,'{}'),
            coalesce(p_click_ids,'{}'), p_landing_path, 'landing', true,
            coalesce(p_consent_whatsapp,false), coalesce(p_consent_marketing,false))
    returning id into v_lead;
  else
    -- repeat submission: keep first touch, refresh last touch and consents
    update public.leads
       set last_touch_channel = v_channel, last_touch_campaign = p_utm->>'campaign',
           phone = coalesce(phone, v_phone),
           consent_demo_followup = true,
           consent_whatsapp  = consent_whatsapp  or coalesce(p_consent_whatsapp,false),
           consent_marketing = consent_marketing or coalesce(p_consent_marketing,false)
     where id = v_lead;
  end if;

  insert into public.lead_events (tenant_id, lead_id, anon_id, event_name, utm, path)
  values (t.id, v_lead, p_anon_id, 'form_submit', coalesce(p_utm,'{}'), p_landing_path);
  -- link earlier anonymous events from the same consented visitor id
  if p_anon_id is not null then
    update public.lead_events set lead_id = v_lead
     where tenant_id = t.id and anon_id = p_anon_id and lead_id is null;
  end if;

  insert into public.consent_log (tenant_id, lead_id, subject_ref, purpose, action, notice_version, captured_via)
  select t.id, v_lead, v_subject, x.purpose, 'granted', coalesce(p_notice_version,'v1'), 'landing_form'
    from (values ('demo_followup'::public.consent_purpose, true),
                 ('whatsapp'::public.consent_purpose, coalesce(p_consent_whatsapp,false)),
                 ('marketing_email'::public.consent_purpose, coalesce(p_consent_marketing,false))) x(purpose, given)
   where x.given;

  return v_lead;
end $$;

create or replace function public.track_event(
  p_tenant_slug text, p_anon_id text, p_event_name text,
  p_path text default null, p_utm jsonb default '{}', p_props jsonb default '{}'
) returns void
language plpgsql security definer set search_path = '' as $$
declare t_id uuid;
begin
  select id into t_id from public.tenants where slug = p_tenant_slug and lead_intake_enabled;
  if t_id is null then raise exception 'unknown tenant' using errcode = '22023'; end if;
  if p_event_name not in ('page_view','cta_click','form_start','tour_play','pricing_view','demo_booked') then
    raise exception 'event not allowed' using errcode = '22023'; end if;
  if p_anon_id is null or length(p_anon_id) not between 8 and 64 then
    raise exception 'anon_id required (consented visitors only)' using errcode = '22023'; end if;
  if pg_column_size(p_props) > 2000 or pg_column_size(p_utm) > 2000 then
    raise exception 'payload too large' using errcode = '22023'; end if;
  if (select count(*) from public.lead_events
       where tenant_id = t_id and anon_id = p_anon_id and occurred_at > now() - interval '1 minute') >= 60 then
    return;  -- silently drop floods
  end if;
  insert into public.lead_events (tenant_id, lead_id, anon_id, event_name, utm, path, props)
  values (t_id, (select lead_id from public.lead_events
                  where tenant_id = t_id and anon_id = p_anon_id and lead_id is not null limit 1),
          p_anon_id, p_event_name, coalesce(p_utm,'{}'), left(p_path, 300), coalesce(p_props,'{}'));
end $$;

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

-- Shorthand used below:  T = (tenant_id = public.current_tenant_id())
-- tenants
create policy tenants_select on public.tenants for select to authenticated
  using (id = public.current_tenant_id());
create policy tenants_update on public.tenants for update to authenticated
  using (id = public.current_tenant_id() and public.has_role('owner'))
  with check (id = public.current_tenant_id());

-- profiles (helpers are SECURITY DEFINER, so no recursion)
create policy profiles_select on public.profiles for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy profiles_update on public.profiles for update to authenticated
  using (tenant_id = public.current_tenant_id()
         and (id = auth.uid() or public.has_role('owner','sales_manager')))
  with check (tenant_id = public.current_tenant_id());

-- invitations: owner any role; sales_manager only rep/viewer
create policy invitations_select on public.invitations for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner','sales_manager'));
create policy invitations_write on public.invitations for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner','sales_manager'))
  with check (tenant_id = public.current_tenant_id()
              and (public.has_role('owner') or (public.has_role('sales_manager') and role in ('sales_rep','viewer'))));

-- config tables: everyone in tenant reads; owner + sales_manager write
create policy pipeline_stages_select on public.pipeline_stages for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy pipeline_stages_write on public.pipeline_stages for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner','sales_manager'))
  with check (tenant_id = public.current_tenant_id());
create policy territories_select on public.territories for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy territories_write on public.territories for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner','sales_manager'))
  with check (tenant_id = public.current_tenant_id());
create policy sales_targets_select on public.sales_targets for select to authenticated
  using (tenant_id = public.current_tenant_id()
         and (public.has_role('owner','sales_manager','viewer') or rep_id = auth.uid()));
create policy sales_targets_write on public.sales_targets for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner','sales_manager'))
  with check (tenant_id = public.current_tenant_id());

-- accounts (firm-level business data; viewers may read)
create policy accounts_select on public.accounts for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy accounts_insert on public.accounts for insert to authenticated
  with check (tenant_id = public.current_tenant_id()
              and public.has_role('owner','sales_manager','sales_rep','marketing','data'));
create policy accounts_update on public.accounts for update to authenticated
  using (tenant_id = public.current_tenant_id()
         and (public.has_role('owner','sales_manager','data') or (public.has_role('sales_rep') and owner_id = auth.uid())))
  with check (tenant_id = public.current_tenant_id());
create policy accounts_delete on public.accounts for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner'));

-- contacts (personal data): no viewer; reps only own contacts or contacts on their accounts
create policy contacts_select on public.contacts for select to authenticated
  using (tenant_id = public.current_tenant_id()
         and (public.has_role('owner','sales_manager','marketing','data')
              or (public.has_role('sales_rep') and (owner_id = auth.uid()
                  or exists (select 1 from public.accounts a where a.id = contacts.account_id and a.owner_id = auth.uid())))));
create policy contacts_insert on public.contacts for insert to authenticated
  with check (tenant_id = public.current_tenant_id()
              and public.has_role('owner','sales_manager','sales_rep','marketing','data'));
create policy contacts_update on public.contacts for update to authenticated
  using (tenant_id = public.current_tenant_id()
         and (public.has_role('owner','sales_manager','data') or (public.has_role('sales_rep') and owner_id = auth.uid())))
  with check (tenant_id = public.current_tenant_id());
create policy contacts_delete on public.contacts for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner'));

-- leads: reps see own + unassigned in their territory; viewers use v_leads_masked
create policy leads_select on public.leads for select to authenticated
  using (tenant_id = public.current_tenant_id()
         and (public.has_role('owner','sales_manager','marketing','data')
              or (public.has_role('sales_rep') and (owner_id = auth.uid()
                  or (owner_id is null and exists (select 1 from public.territories t
                        where t.tenant_id = leads.tenant_id and t.rep_id = auth.uid()
                          and lower(t.district) = lower(leads.district)))))));
create policy leads_insert on public.leads for insert to authenticated
  with check (tenant_id = public.current_tenant_id()
              and (public.has_role('owner','sales_manager','marketing','data')
                   or (public.has_role('sales_rep') and owner_id = auth.uid())));
create policy leads_update on public.leads for update to authenticated
  using (tenant_id = public.current_tenant_id()
         and (public.has_role('owner','sales_manager','marketing','data')
              or (public.has_role('sales_rep') and (owner_id = auth.uid()
                  or (owner_id is null and exists (select 1 from public.territories t
                        where t.tenant_id = leads.tenant_id and t.rep_id = auth.uid()
                          and lower(t.district) = lower(leads.district)))))))
  with check (tenant_id = public.current_tenant_id()
              and (public.has_role('owner','sales_manager','marketing','data') or owner_id = auth.uid()));
create policy leads_delete on public.leads for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner'));

-- lead_events
create policy lead_events_select on public.lead_events for select to authenticated
  using (tenant_id = public.current_tenant_id()
         and (public.has_role('owner','sales_manager','marketing','data')
              or (public.has_role('sales_rep') and exists (select 1 from public.leads l
                    where l.id = lead_events.lead_id and l.owner_id = auth.uid()))));
create policy lead_events_insert on public.lead_events for insert to authenticated
  with check (tenant_id = public.current_tenant_id()
              and public.has_role('owner','sales_manager','sales_rep','marketing','data'));

-- deals: viewers read (no personal data on deals); reps own only
create policy deals_select on public.deals for select to authenticated
  using (tenant_id = public.current_tenant_id()
         and (public.has_role('owner','sales_manager','marketing','data','viewer') or owner_id = auth.uid()));
create policy deals_insert on public.deals for insert to authenticated
  with check (tenant_id = public.current_tenant_id()
              and (public.has_role('owner','sales_manager') or (public.has_role('sales_rep') and owner_id = auth.uid())));
create policy deals_update on public.deals for update to authenticated
  using (tenant_id = public.current_tenant_id()
         and (public.has_role('owner','sales_manager') or (public.has_role('sales_rep') and owner_id = auth.uid())))
  with check (tenant_id = public.current_tenant_id()
              and (public.has_role('owner','sales_manager') or owner_id = auth.uid()));
create policy deals_delete on public.deals for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner'));

create policy dsh_select on public.deal_stage_history for select to authenticated
  using (tenant_id = public.current_tenant_id()
         and exists (select 1 from public.deals d where d.id = deal_stage_history.deal_id));  -- inherits deals RLS

-- activities
create policy activities_select on public.activities for select to authenticated
  using (tenant_id = public.current_tenant_id()
         and (public.has_role('owner','sales_manager','marketing')
              or owner_id = auth.uid()
              or (public.has_role('sales_rep') and exists (select 1 from public.leads l
                    where l.id = activities.lead_id and l.owner_id = auth.uid()))));
create policy activities_insert on public.activities for insert to authenticated
  with check (tenant_id = public.current_tenant_id()
              and (public.has_role('owner','sales_manager') or (public.has_role('sales_rep') and owner_id = auth.uid())));
create policy activities_update on public.activities for update to authenticated
  using (tenant_id = public.current_tenant_id() and (public.has_role('owner','sales_manager') or owner_id = auth.uid()))
  with check (tenant_id = public.current_tenant_id());
create policy activities_delete on public.activities for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner'));

-- tasks
create policy tasks_select on public.tasks for select to authenticated
  using (tenant_id = public.current_tenant_id()
         and (public.has_role('owner','sales_manager') or assignee_id = auth.uid() or created_by = auth.uid()));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and not public.has_role('viewer')
              and (public.has_role('owner','sales_manager') or assignee_id = auth.uid()));
create policy tasks_update on public.tasks for update to authenticated
  using (tenant_id = public.current_tenant_id()
         and (public.has_role('owner','sales_manager') or assignee_id = auth.uid()))
  with check (tenant_id = public.current_tenant_id()
              and (public.has_role('owner','sales_manager') or assignee_id = auth.uid()));
create policy tasks_delete on public.tasks for delete to authenticated
  using (tenant_id = public.current_tenant_id()
         and (public.has_role('owner','sales_manager') or created_by = auth.uid()));

-- campaigns: all roles read names (reps see campaign on a lead); owner + marketing write
create policy campaigns_select on public.campaigns for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy campaigns_write on public.campaigns for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner','marketing'))
  with check (tenant_id = public.current_tenant_id());
create policy cdm_select on public.campaign_daily_metrics for select to authenticated
  using (tenant_id = public.current_tenant_id() and not public.has_role('sales_rep'));
create policy cdm_write on public.campaign_daily_metrics for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner','marketing','data'))
  with check (tenant_id = public.current_tenant_id());
create policy segments_select on public.audience_segments for select to authenticated
  using (tenant_id = public.current_tenant_id() and not public.has_role('sales_rep'));
create policy segments_write on public.audience_segments for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner','marketing','data'))
  with check (tenant_id = public.current_tenant_id());
create policy ga4_select on public.ga4_daily for select to authenticated
  using (tenant_id = public.current_tenant_id() and not public.has_role('sales_rep'));

-- inbox
create policy templates_select on public.message_templates for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy templates_write on public.message_templates for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner','sales_manager','marketing'))
  with check (tenant_id = public.current_tenant_id());
create policy conversations_select on public.conversations for select to authenticated
  using (tenant_id = public.current_tenant_id()
         and (public.has_role('owner','sales_manager','marketing')
              or (public.has_role('sales_rep') and assignee_id = auth.uid())));
create policy conversations_write on public.conversations for all to authenticated
  using (tenant_id = public.current_tenant_id()
         and (public.has_role('owner','sales_manager') or (public.has_role('sales_rep') and assignee_id = auth.uid())))
  with check (tenant_id = public.current_tenant_id()
              and (public.has_role('owner','sales_manager') or assignee_id = auth.uid()));
create policy messages_select on public.messages for select to authenticated
  using (tenant_id = public.current_tenant_id()
         and exists (select 1 from public.conversations c where c.id = messages.conversation_id));  -- inherits conversations RLS
create policy messages_insert on public.messages for insert to authenticated
  with check (tenant_id = public.current_tenant_id()
              and public.has_role('owner','sales_manager','sales_rep')
              and sent_by = auth.uid()
              and exists (select 1 from public.conversations c where c.id = messages.conversation_id
                          and (public.has_role('owner','sales_manager') or c.assignee_id = auth.uid())));

-- integrations
create policy integrations_select on public.integrations for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner','sales_manager','marketing','data'));
create policy integrations_write on public.integrations for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner'))
  with check (tenant_id = public.current_tenant_id());
create policy ifm_select on public.integration_field_maps for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner','sales_manager','marketing','data'));
create policy ifm_write on public.integration_field_maps for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner','data'))
  with check (tenant_id = public.current_tenant_id());
create policy sync_runs_select on public.sync_runs for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner','sales_manager','marketing','data'));
create policy sync_runs_insert on public.sync_runs for insert to authenticated   -- CSV imports from the app
  with check (tenant_id = public.current_tenant_id() and public.has_role('owner','marketing','data')
              and kind = 'csv' and started_by = auth.uid());
create policy sync_runs_update on public.sync_runs for update to authenticated
  using (tenant_id = public.current_tenant_id() and started_by = auth.uid())
  with check (tenant_id = public.current_tenant_id());

-- backups (rows are written by the backup job with the service role)
create policy backup_checks_select on public.backup_checks for select to authenticated
  using ((tenant_id is null or tenant_id = public.current_tenant_id())
         and public.has_role('owner','sales_manager','data'));
create policy backup_rules_select on public.backup_alert_rules for select to authenticated
  using ((tenant_id is null or tenant_id = public.current_tenant_id())
         and public.has_role('owner','sales_manager','data'));
create policy backup_rules_write on public.backup_alert_rules for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner'))
  with check (tenant_id = public.current_tenant_id());

-- AI insights: requester or owner/sales_manager
create policy ai_select on public.ai_insights for select to authenticated
  using (tenant_id = public.current_tenant_id()
         and (user_id = auth.uid() or public.has_role('owner','sales_manager')));
create policy ai_insert on public.ai_insights for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and user_id = auth.uid() and not public.has_role('viewer'));
create policy ai_update on public.ai_insights for update to authenticated
  using (tenant_id = public.current_tenant_id() and user_id = auth.uid())
  with check (tenant_id = public.current_tenant_id() and user_id = auth.uid());

-- consent_log: append-only
create policy consent_select on public.consent_log for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner','sales_manager','data'));
create policy consent_insert on public.consent_log for insert to authenticated
  with check (tenant_id = public.current_tenant_id()
              and public.has_role('owner','sales_manager','sales_rep','data')
              and recorded_by = auth.uid());

-- audit_log: read-only for owner + sales_manager; written only by trigger
create policy audit_select on public.audit_log for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role('owner','sales_manager'));

-- =====================================================================
-- 19. Views (aggregates; deliberately run as view owner, filtered to the caller's tenant
--     and role inside the view, and expose no personal data. Viewers read dashboards
--     through these without row access to leads/contacts.)
-- =====================================================================
create view public.v_funnel_daily with (security_barrier = true) as
select e.tenant_id,
       (e.occurred_at at time zone 'Asia/Kolkata')::date as day,
       e.event_name,
       count(*) as events,
       count(distinct coalesce(e.lead_id::text, e.anon_id)) as people
  from public.lead_events e
 where e.tenant_id = public.current_tenant_id()
 group by 1, 2, 3;

create view public.v_campaign_perf with (security_barrier = true) as
with m as (
  select campaign_id, sum(spend_inr) spend_inr, sum(reach) reach, sum(impressions) impressions,
         sum(clicks) clicks, sum(reactions + comments + shares) interactions, sum(opens) opens,
         sum(platform_leads) platform_leads
    from public.campaign_daily_metrics
   where tenant_id = public.current_tenant_id()
   group by campaign_id
), l as (
  select ld.first_touch_campaign as utm_campaign, count(*) leads
    from public.leads ld
   where ld.tenant_id = public.current_tenant_id() and ld.deleted_at is null
   group by 1
), d as (
  select ld.first_touch_campaign as utm_campaign,
         count(distinct dl.id) filter (where exists (select 1 from public.deal_stage_history h
              join public.pipeline_stages s on s.id = h.to_stage_id
             where h.deal_id = dl.id and s.position >= (select s2.position from public.pipeline_stages s2
                    where s2.tenant_id = dl.tenant_id and s2.key = 'demo_scheduled')
               and not s.is_lost)) as demos,
         count(*) filter (where dl.won_at is not null) as won_deals,
         coalesce(sum(dl.value_inr) filter (where dl.won_at is not null), 0) as revenue_inr
    from public.deals dl join public.leads ld on ld.id = dl.lead_id
   where dl.tenant_id = public.current_tenant_id() and dl.deleted_at is null
   group by 1
)
select c.tenant_id, c.id as campaign_id, c.name, c.channel, c.status, c.utm_campaign,
       coalesce(m.spend_inr,0) spend_inr, coalesce(m.reach,0) reach, coalesce(m.impressions,0) impressions,
       coalesce(m.clicks,0) clicks, coalesce(m.interactions,0) interactions, coalesce(m.platform_leads,0) platform_leads,
       coalesce(l.leads,0) leads, coalesce(d.demos,0) demos, coalesce(d.won_deals,0) won_deals,
       coalesce(d.revenue_inr,0) revenue_inr,
       round(m.clicks::numeric / nullif(m.impressions,0), 4)                         as ctr,          -- M7
       round(m.spend_inr / nullif(l.leads,0), 2)                                     as cpl_inr,      -- M9
       round(m.spend_inr / nullif(d.demos,0), 2)                                     as cost_per_demo_inr, -- M11
       round(coalesce(l.leads,0)::numeric / nullif(m.clicks,0), 4)                   as click_to_lead, -- M47
       round((m.clicks + m.interactions + case when c.channel = 'email' then m.opens else 0 end)::numeric
             / nullif(m.impressions,0), 4)                                           as engagement_rate, -- M46
       round(d.revenue_inr / nullif(m.spend_inr,0), 2)                               as roas,         -- M43
       coalesce(m.platform_leads,0) - coalesce(l.leads,0)                            as platform_crm_gap -- M13
  from public.campaigns c
  left join m on m.campaign_id = c.id
  left join l on l.utm_campaign = c.utm_campaign
  left join d on d.utm_campaign = c.utm_campaign
 where c.tenant_id = public.current_tenant_id() and not public.has_role('sales_rep');

-- M45 reach profile: 5 axes normalised 0-100 within the tenant (all-time; app filters period via cdm if needed)
create view public.v_campaign_reach_profile with (security_barrier = true) as
select p.tenant_id, p.campaign_id, p.name, p.channel,
       round(100.0 * p.reach / nullif(max(p.reach) over (), 0))::int                           as axis_reach,
       round(100.0 * p.engagement_rate / nullif(max(p.engagement_rate) over (), 0))::int       as axis_engagement,
       round(100.0 * p.ctr / nullif(max(p.ctr) over (), 0))::int                               as axis_ctr,
       round(100.0 * p.click_to_lead / nullif(max(p.click_to_lead) over (), 0))::int           as axis_lead_rate,
       case when p.spend_inr = 0 and p.leads > 0 then 100           -- zero-cost channel with leads
            when p.leads = 0 then 0                                    -- no leads: no efficiency
            else coalesce(round(100.0 * (min(p.cpl_inr) over ()) / nullif(p.cpl_inr, 0))::int, 0) end as axis_cost_efficiency
  from public.v_campaign_perf p;

create view public.v_pipeline_summary with (security_barrier = true) as
select s.tenant_id, s.id as stage_id, s.key, s.label, s.position, s.probability,
       count(d.id) as deals,
       coalesce(sum(d.value_inr), 0) as value_inr,                                  -- M34
       round(coalesce(sum(d.value_inr * s.probability / 100.0), 0), 2) as weighted_value_inr, -- M35
       count(d.id) filter (where now() - d.stage_entered_at > make_interval(days => s.max_days)) as stuck_deals -- M41
  from public.pipeline_stages s
  left join public.deals d on d.stage_id = s.id and d.deleted_at is null
 where s.tenant_id = public.current_tenant_id()
 group by s.tenant_id, s.id;

-- Rep scorecard, current month (IST). Reps see only their own row.
create view public.v_rep_scorecard with (security_barrier = true) as
with bounds as (
  select date_trunc('month', now() at time zone 'Asia/Kolkata')::date as m
)
select p.tenant_id, p.id as rep_id, p.full_name,
       (select count(*) from public.leads l where l.owner_id = p.id and l.deleted_at is null
          and l.status not in ('disqualified','converted')) as open_leads,
       (select count(*) from public.leads l where l.owner_id = p.id
          and l.created_at >= (select m from bounds)) as leads_this_month,
       (select round(100.0 * count(*) filter (where l.first_response_at - l.created_at
                   <= make_interval(mins => t.sla_first_response_mins)) / nullif(count(*),0), 1)
          from public.leads l where l.owner_id = p.id and l.created_at >= now() - interval '30 days') as sla_pct_30d,
       (select count(*) from public.activities a where a.owner_id = p.id and a.kind = 'meeting'
          and a.meeting_type = 'demo' and a.done_at >= (select m from bounds)) as demos_done,
       (select coalesce(sum(d.value_inr),0) from public.deals d where d.owner_id = p.id
          and d.won_at >= (select m from bounds)) as won_value_inr,
       st.target_demos, st.won_value_inr as target_won_inr,
       round(100.0 * (select coalesce(sum(d.value_inr),0) from public.deals d where d.owner_id = p.id
          and d.won_at >= (select m from bounds)) / nullif(st.won_value_inr,0), 1) as attainment_pct  -- M38
  from public.profiles p
  join public.tenants t on t.id = p.tenant_id
  left join public.sales_targets st on st.rep_id = p.id and st.month = (select m from bounds)
 where p.tenant_id = public.current_tenant_id() and p.role = 'sales_rep' and p.is_active
   and (public.has_role('owner','sales_manager','viewer') or p.id = auth.uid());

-- Masked lead directory for viewers (and anyone needing counts without PII)
create view public.v_leads_masked with (security_barrier = true) as
select l.tenant_id, l.id,
       (with n as (select regexp_replace(l.full_name, '^(adv|dr|mr|ms|mrs|thiru|tmt)\.?\s+', '', 'i') as v)
        select split_part(n.v, ' ', 1) || coalesce(' ' || nullif(left(split_part(n.v, ' ', 2), 1), '') || '.', '') from n) as display_name,
       l.role_title, l.firm_name, l.city, l.district, l.status, l.score, l.first_touch_channel,
       l.first_touch_campaign, l.owner_id, l.created_at,
       case when l.email is not null then '•••@' || split_part(l.email, '@', 2) end as email_masked,
       case when l.phone is not null then '••••••' || right(l.phone, 4) end as phone_masked
  from public.leads l
 where l.tenant_id = public.current_tenant_id() and l.deleted_at is null
   and public.has_role('owner','sales_manager','marketing','data','viewer');

create view public.v_backup_latest with (security_barrier = true) as
select distinct on (b.check_kind) b.check_kind, b.status, b.checked_at, b.backup_taken_at, b.size_bytes,
       b.retention_days, b.pitr_enabled, b.location,
       extract(epoch from now() - b.backup_taken_at) / 3600 as age_hours   -- M24
  from public.backup_checks b
 where (b.tenant_id is null or b.tenant_id = public.current_tenant_id())
   and b.status = 'success' and public.has_role('owner','sales_manager','data')
 order by b.check_kind, b.checked_at desc;

create view public.v_sync_freshness with (security_barrier = true) as
select i.tenant_id, i.provider, i.label, i.category, i.status, i.last_sync_at,
       extract(epoch from now() - i.last_sync_at) / 3600 as hours_since_sync,               -- M27
       (select count(*) filter (where r.status = 'failed')::numeric / nullif(count(*),0)
          from public.sync_runs r where r.integration_id = i.id
           and r.started_at > now() - interval '7 days') as error_rate_7d                   -- M56
  from public.integrations i
 where i.tenant_id = public.current_tenant_id()
   and public.has_role('owner','sales_manager','marketing','data');

-- =====================================================================
-- 20. Grants
-- =====================================================================
revoke all on all tables in schema public from anon;
do $$
declare t text;
begin
  foreach t in array array['tenants','profiles','invitations','pipeline_stages','territories','sales_targets',
    'accounts','contacts','campaigns','campaign_daily_metrics','audience_segments','leads','lead_events',
    'deals','deal_stage_history','activities','tasks','message_templates','conversations','messages',
    'ga4_daily','integrations','integration_field_maps','sync_runs','backup_checks','backup_alert_rules',
    'ai_insights','consent_log'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
grant select on public.audit_log to authenticated;
revoke insert, update, delete on public.audit_log from authenticated;
revoke update, delete on public.consent_log from authenticated;   -- append-only
grant select on public.v_funnel_daily, public.v_campaign_perf, public.v_campaign_reach_profile,
                public.v_pipeline_summary, public.v_rep_scorecard, public.v_leads_masked,
                public.v_backup_latest, public.v_sync_freshness to authenticated;

-- Functions: helpers callable by signed-in users; intake functions by anon; trigger functions by nobody.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.current_tenant_id(), public.current_app_role(),
                          public.has_role(public.app_role[]) to authenticated;
grant execute on function public.tenant_branding(text, text) to anon, authenticated;
grant execute on function public.submit_lead(text, text, text, text, text, text, text, text, text,
                          boolean, boolean, boolean, text, jsonb, jsonb, text, text) to anon, authenticated;
grant execute on function public.track_event(text, text, text, text, jsonb, jsonb) to anon, authenticated;

-- =====================================================================
-- 21. Default pipeline for a new tenant (call after inserting a tenant; service role)
-- =====================================================================
create or replace function public.seed_tenant_defaults(p_tenant uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.pipeline_stages (tenant_id, key, label, position, probability, max_days, is_won, is_lost) values
    (p_tenant, 'discovery',      'Discovery',       1, 10, 14, false, false),
    (p_tenant, 'demo_scheduled', 'Demo scheduled',  2, 25, 10, false, false),
    (p_tenant, 'demo_done',      'Demo done',       3, 40, 14, false, false),
    (p_tenant, 'proposal',       'Proposal sent',   4, 60, 14, false, false),
    (p_tenant, 'negotiation',    'Negotiation',     5, 80, 21, false, false),
    (p_tenant, 'won',            'Won',             6, 100, 999, true, false),
    (p_tenant, 'lost',           'Lost',            7, 0, 999, false, true)
  on conflict do nothing;
  insert into public.integrations (tenant_id, provider, label, category, direction, status, auth_method) values
    (p_tenant, 'zoho_crm',   'Zoho CRM',              'crm',           'both', 'showcase', 'OAuth 2.0'),
    (p_tenant, 'whatsapp',   'WhatsApp Business',     'messaging',     'both', 'showcase', 'System user token'),
    (p_tenant, 'linkedin',   'LinkedIn',              'social_ads',    'in',   'showcase', 'OAuth 2.0'),
    (p_tenant, 'mailchimp',  'Mailchimp',             'email',         'in',   'showcase', 'API key / OAuth 2.0'),
    (p_tenant, 'ga4',        'Google Analytics 4',    'analytics',     'both', 'showcase', 'Service account'),
    (p_tenant, 'meta_ads',   'Meta Ads',              'social_ads',    'both', 'showcase', 'System user token'),
    (p_tenant, 'google_ads', 'Google Ads',            'social_ads',    'both', 'showcase', 'OAuth 2.0 + developer token'),
    (p_tenant, 'gmail',      'Gmail / Outlook',       'email',         'both', 'showcase', 'OAuth 2.0'),
    (p_tenant, 'calendly',   'Calendly / Cal.com',    'calendar',      'in',   'showcase', 'OAuth / API key'),
    (p_tenant, 'slack',      'Slack',                 'notifications', 'out',  'showcase', 'Incoming webhook'),
    (p_tenant, 'zapier',     'Zapier / Make',         'automation',    'both', 'showcase', 'Signed webhooks'),
    (p_tenant, 'razorpay',   'Razorpay',              'payments',      'in',   'showcase', 'Key + webhook secret'),
    (p_tenant, 'landing',    'LAWSOME landing page',  'internal',      'in',   'not_configured', 'submit_lead RPC'),
    (p_tenant, 'csv',        'CSV import',            'internal',      'in',   'connected', 'User session')
  on conflict do nothing;
$$;
revoke execute on function public.seed_tenant_defaults(uuid) from public, anon, authenticated;
