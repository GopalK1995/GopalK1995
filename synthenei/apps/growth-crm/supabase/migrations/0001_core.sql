-- 0001 core: enums, tables, indexes, RLS helper functions
-- Derived from apps/growth-crm/supabase/schema.sql. Apply in filename order.

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
create type public.lead_status        as enum ('new','contacted','qualified','nurturing','disqualified','converted');
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
  plan            text check (plan in ('practice','chambers','enterprise')),  -- placeholder names until LAWSOME pricing is shared
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
  provider      text not null,   -- zoho_crm|hubspot|whatsapp|linkedin|mailchimp|ga4|meta_ads|google_ads|gmail|outlook|calendly|calcom|slack|zapier|make|razorpay|landing|csv
                                 -- route id in the UI = provider with '_' -> '-' (e.g. /integrations/zoho-crm)
  label         text not null,
  category      text not null check (category in ('crm','messaging','email','ads','analytics','scheduling','payments','automation','internal')),
  direction     text not null check (direction in ('in','out','both')),
  status        public.integration_status not null default 'showcase',
  auth_method   text,
  config_ref    text,            -- NAME of a secret in Vault / env. Never the secret itself.
  settings      jsonb not null default '{}',   -- {"sample_feed":true} = showcase card fed by sample data ('demo fed' in UI)
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
