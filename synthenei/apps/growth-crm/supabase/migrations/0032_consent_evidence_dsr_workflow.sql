-- 0032 consent evidence + data-subject-request workflow (AUD-063: PRIV-012, PRIV-013, PRIV-015, PRIV-028; AUD-064: PRIV-021, PRIV-023, PRIV-054).
-- NOT applied by the agent that wrote it. Apply AFTER the app that knows about it is deployed (the app also works without it: every call
-- feature-detects PGRST202 / PGRST204 / PGRST205 / 42883 / 42703 / 42P01 and falls back to the pre-0032 behaviour).
--
--   PRIV-013  consent rows now carry evidence: notice text hash (FK to notice_versions), form id, an HMAC'd client-address hash and a coarse
--             user-agent class. notice_versions keeps the text snapshot per tenant (append-only). submit_lead no longer trusts the client's
--             notice label: it is resolved against notice_versions (newest published version when unknown).
--   PRIV-012  submit_lead keeps the demo follow-up requirement (the form IS the request) but takes marketing and WhatsApp as separate,
--             optional parameters, and a repeat submission no longer flips the stored flags.
--   PRIV-015  the three lead consent flags are derived from consent_log by a trigger (granted -> true, withdrawn / erasure_completed ->
--             false); public.consent_flag_mismatches() is the reconciliation read; a one-off statement below repairs rows that diverged.
--   PRIV-028  erase_lead writes the person's real subject_ref (read before the address is wiped) and one erasure_completed row per purpose.
--   PRIV-054 / PRIV-023  privacy_tokens: single-use / bounded-use token ledger, hash at rest, consumed atomically by privacy_token_use().
--             Service role only. Verification links register on first use (a replay is refused); status and export-delivery links are
--             issued by the app.
--   PRIV-021  event types for the alerts (privacy.request_received / due_soon / overdue) and the daily sweep job (privacy.dsr_due).
--
-- Prerequisites: 0020 (privacy_requests), 0026 (consent_log append-only). 0030 is NOT required (the address hash is made by the caller).
-- Overload warning: submit_lead gets three new defaulted parameters, so the 17-argument version is DROPPED first. Two overloads with defaults
-- would make PostgREST answer PGRST203 (ambiguous) for every call. Old callers keep working: every new parameter has a default.
--
-- Idempotent. ROLLBACK (manual, in this order) is in supabase/rollback/0032_down.sql:
--   restore submit_lead(17 args) and erase_lead from 0007 (their bodies are there); drop trigger consent_log_flag_sync and the three
--   privacy functions; drop table privacy_tokens; drop the consent_log FK and the four evidence columns (data loss: evidence is gone);
--   drop notice_versions; delete the scheduled_jobs row and the three event_types. Flags repaired by the one-off update stay repaired.

-- ---------- 1. notice_versions: what the person was told ----------
create table if not exists public.notice_versions (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  text_sha256   text not null check (text_sha256 ~ '^[a-f0-9]{64}$'),
  version       text not null check (length(version) between 1 and 40),
  text_snapshot text not null check (length(text_snapshot) between 1 and 60000),
  published_at  timestamptz not null default now(),
  primary key (tenant_id, text_sha256)
);
create index if not exists notice_versions_tenant_version on public.notice_versions (tenant_id, version, published_at desc);
alter table public.notice_versions enable row level security;
drop policy if exists notice_versions_select on public.notice_versions;
create policy notice_versions_select on public.notice_versions for select to authenticated
  using (tenant_id in (select authz.tenant_ids_with('privacy.fulfil', 'own')) or (select public.is_platform_admin()));
revoke all on public.notice_versions from public, anon, authenticated;
grant select on public.notice_versions to authenticated;
grant select, insert on public.notice_versions to service_role;

-- append-only: a published text never changes. Deletes only through a tenant cascade (trigger depth > 1).
create or replace function private.notice_versions_append_only() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'notice_versions is append-only' using errcode = '42501';
end $$;
revoke all on function private.notice_versions_append_only() from public, anon, authenticated;
drop trigger if exists notice_versions_append_only on public.notice_versions;
create trigger notice_versions_append_only before update or delete on public.notice_versions
  for each row execute function private.notice_versions_append_only();

-- ---------- 2. consent_log evidence columns ----------
alter table public.consent_log
  add column if not exists notice_sha256 text,
  add column if not exists form_id       text,
  add column if not exists ip_hash       text,
  add column if not exists ua_class      text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'consent_log_evidence_shape' and conrelid = 'public.consent_log'::regclass) then
    alter table public.consent_log add constraint consent_log_evidence_shape check (
      (notice_sha256 is null or notice_sha256 ~ '^[a-f0-9]{64}$')
      and (form_id is null or form_id ~ '^[A-Za-z0-9_./@:-]{1,80}$')
      and (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$')
      and (ua_class is null or ua_class in ('mobile', 'desktop', 'tablet', 'bot', 'unknown')));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'consent_log_notice_fk' and conrelid = 'public.consent_log'::regclass) then
    alter table public.consent_log add constraint consent_log_notice_fk
      foreign key (tenant_id, notice_sha256) references public.notice_versions (tenant_id, text_sha256);
  end if;
end $$;
create index if not exists consent_log_notice on public.consent_log (tenant_id, notice_sha256) where notice_sha256 is not null;

-- ---------- 3. lead consent flags follow consent_log ----------
create or replace function private.consent_flag_sync() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.lead_id is null then return null; end if;
  if new.action in ('granted', 'withdrawn') then
    if new.purpose = 'demo_followup' then
      update public.leads set consent_demo_followup = (new.action = 'granted') where id = new.lead_id and consent_demo_followup is distinct from (new.action = 'granted');
    elsif new.purpose = 'marketing_email' then
      update public.leads set consent_marketing = (new.action = 'granted') where id = new.lead_id and consent_marketing is distinct from (new.action = 'granted');
    elsif new.purpose = 'whatsapp' then
      update public.leads set consent_whatsapp = (new.action = 'granted') where id = new.lead_id and consent_whatsapp is distinct from (new.action = 'granted');
    end if;
  elsif new.action = 'erasure_completed' then
    update public.leads set consent_demo_followup = false, consent_marketing = false, consent_whatsapp = false
     where id = new.lead_id and (consent_demo_followup or consent_marketing or consent_whatsapp);
  end if;
  return null;
end $$;
revoke all on function private.consent_flag_sync() from public, anon, authenticated;
drop trigger if exists consent_log_flag_sync on public.consent_log;
create trigger consent_log_flag_sync after insert on public.consent_log for each row execute function private.consent_flag_sync();

-- Reconciliation read: leads whose stored flag disagrees with the newest consent_log row for the same lead and purpose.
-- A lead with no row for a purpose is not compared (imports and legacy rows carry no evidence). Service role, or an owner of the workspace.
create or replace function public.consent_flag_mismatches(p_workspace uuid)
returns table (lead_id uuid, purpose text, flag boolean, latest_action text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  elsif p_workspace is null or p_workspace not in (select authz.ws_with('privacy.fulfil', 'own')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    with newest as (
      select distinct on (c.lead_id, c.purpose) c.lead_id as lid, c.purpose as pur, c.action as act
        from public.consent_log c
       where c.workspace_id = p_workspace and c.lead_id is not null and c.purpose in ('demo_followup', 'marketing_email', 'whatsapp')
       order by c.lead_id, c.purpose, c.occurred_at desc, c.id desc)
    select l.id, n.pur::text,
           case n.pur when 'demo_followup' then l.consent_demo_followup when 'marketing_email' then l.consent_marketing else l.consent_whatsapp end,
           n.act::text
      from newest n join public.leads l on l.id = n.lid
     where (case n.pur when 'demo_followup' then l.consent_demo_followup when 'marketing_email' then l.consent_marketing else l.consent_whatsapp end)
           is distinct from (n.act = 'granted');
end $$;
revoke all on function public.consent_flag_mismatches(uuid) from public, anon;
grant execute on function public.consent_flag_mismatches(uuid) to authenticated, service_role;

-- One-off repair of flags that already diverged (the five live leads that withdrew marketing in PRIV-015). Only the three flagged
-- purposes, only leads with a log row, only where the newest row disagrees. Runs as the migration owner, so no policy gets in the way.
update public.leads l set consent_marketing = false
 where l.consent_marketing and (select c.action from public.consent_log c where c.lead_id = l.id and c.purpose = 'marketing_email' order by c.occurred_at desc, c.id desc limit 1) in ('withdrawn', 'erasure_completed');
update public.leads l set consent_whatsapp = false
 where l.consent_whatsapp and (select c.action from public.consent_log c where c.lead_id = l.id and c.purpose = 'whatsapp' order by c.occurred_at desc, c.id desc limit 1) in ('withdrawn', 'erasure_completed');
update public.leads l set consent_demo_followup = false
 where l.consent_demo_followup and (select c.action from public.consent_log c where c.lead_id = l.id and c.purpose = 'demo_followup' order by c.occurred_at desc, c.id desc limit 1) in ('withdrawn', 'erasure_completed');

-- ---------- 4. submit_lead with evidence (replaces the 17-argument version) ----------
drop function if exists public.submit_lead(text, text, text, text, text, text, text, text, text, boolean, boolean, boolean, text, jsonb, jsonb, text, text);

create or replace function public.submit_lead(
  p_workspace          text,
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
  p_landing_path       text default null,
  p_form_id            text default null,   -- evidence (0032): which form version the person saw
  p_ip_hash            text default null,   -- evidence: HMAC-SHA256 hex of the client address, computed by the caller; never the address
  p_ua_class           text default null    -- evidence: coarse user-agent class (mobile, desktop, tablet, bot, unknown)
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  w          public.workspaces;
  v_name     text := trim(p_full_name);
  v_email    text := lower(trim(p_email));
  v_phone    text := nullif(regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g'), '');
  v_firm     text := nullif(trim(p_firm_name), '');
  v_role     text := nullif(trim(p_role_title), '');
  v_city     text := nullif(trim(p_city), '');
  v_district text := nullif(trim(p_district), '');
  v_practice text := nullif(trim(p_practice_area), '');
  v_path     text := left(nullif(trim(p_landing_path), ''), 300);
  v_anon     text := nullif(trim(p_anon_id), '');
  v_notice   text := coalesce(nullif(trim(p_notice_version), ''), 'v1');
  v_notice_sha text;
  v_form     text := case when p_form_id ~ '^[A-Za-z0-9_./@:-]{1,80}$' then p_form_id end;
  v_ip_hash  text := case when p_ip_hash ~ '^[a-f0-9]{64}$' then p_ip_hash end;
  v_ua       text := case when p_ua_class in ('mobile', 'desktop', 'tablet', 'bot', 'unknown') then p_ua_class end;
  v_nv_ver   text;
  v_nv_sha   text;
  v_utm      jsonb := '{}';
  v_clicks   jsonb := '{}';
  v_src      text;
  v_med      text;
  v_subject  text;
  v_lead     uuid;
  v_account  uuid;
  v_campaign uuid;
  v_channel  public.channel_kind;
  v_personal boolean;
  v_factors  jsonb := '[]';
  v_score    int := 0;
begin
  select ws.* into w from public.workspaces ws join public.tenants t on t.id = ws.tenant_id
   where (ws.slug = p_workspace or ws.id::text = p_workspace)
     and ws.lead_intake_enabled and ws.archived_at is null and t.status = 'active';
  if w.id is null then raise exception 'unknown workspace' using errcode = '22023'; end if;

  -- PRIV-013: the notice label is not trusted. Resolve it against the tenant's published notice_versions: a known label keeps its text hash,
  -- an unknown label falls back to the newest published version; a tenant that has published nothing keeps the label with no hash.
  select nv.version, nv.text_sha256 into v_nv_ver, v_nv_sha from public.notice_versions nv
   where nv.tenant_id = w.tenant_id and nv.version = v_notice order by nv.published_at desc limit 1;
  if v_nv_sha is null then
    select nv.version, nv.text_sha256 into v_nv_ver, v_nv_sha from public.notice_versions nv
     where nv.tenant_id = w.tenant_id order by nv.published_at desc limit 1;
  end if;
  if v_nv_sha is not null then v_notice := v_nv_ver; v_notice_sha := v_nv_sha; end if;

  -- validation (mirrors apps/lawsome-landing/src/app/api/leads/route.ts)
  if v_name is null or length(v_name) not between 2 and 120 then
    raise exception 'invalid name' using errcode = '22023'; end if;
  if v_email is null or length(v_email) > 160 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then
    raise exception 'invalid email' using errcode = '22023'; end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{8,15}$' then
    raise exception 'invalid phone' using errcode = '22023'; end if;
  if length(coalesce(v_firm,'')) > 160 or length(coalesce(v_role,'')) > 80
     or length(coalesce(v_city,'')) > 80 or length(coalesce(v_district,'')) > 80
     or length(coalesce(v_practice,'')) > 80 or length(v_notice) > 20
     or (v_anon is not null and length(v_anon) not between 8 and 64) then
    raise exception 'field too long' using errcode = '22023'; end if;
  if v_role is not null and v_role not in ('Managing partner / owner','Senior advocate / practice head',
       'Associate / lawyer','Legal operations / admin','Other') then
    raise exception 'invalid role' using errcode = '22023'; end if;
  v_district := initcap(v_district);
  if v_district is not null and v_district not in ('Ariyalur','Chengalpattu','Chennai','Coimbatore',
       'Cuddalore','Dharmapuri','Dindigul','Erode','Kallakurichi','Kanchipuram','Kanniyakumari','Karur','Krishnagiri',
       'Madurai','Mayiladuthurai','Nagapattinam','Namakkal','Nilgiris','Perambalur','Pudukkottai','Ramanathapuram',
       'Ranipet','Salem','Sivaganga','Tenkasi','Thanjavur','Theni','Thoothukudi','Tiruchirappalli','Tirunelveli',
       'Tirupathur','Tiruppur','Tiruvallur','Tiruvannamalai','Tiruvarur','Vellore','Viluppuram','Virudhunagar','Puducherry',
       -- Kerala pilot workspace
       'Thiruvananthapuram','Kollam','Pathanamthitta','Alappuzha','Kottayam','Idukki','Ernakulam','Thrissur',
       'Palakkad','Malappuram','Kozhikode','Wayanad','Kannur','Kasaragod') then
    v_district := null;
  end if;
  if not coalesce(p_consent_followup, false) then
    raise exception 'consent for demo follow-up is required' using errcode = '22023'; end if;
  if pg_column_size(p_utm) > 2000 or pg_column_size(p_click_ids) > 1000 then
    raise exception 'payload too large' using errcode = '22023'; end if;

  -- keep only whitelisted, string-valued keys (accepts "source" or "utm_source")
  if jsonb_typeof(p_utm) = 'object' then
    select coalesce(jsonb_object_agg(k, left(v, 120)), '{}') into v_utm
      from (select regexp_replace(key, '^utm_', '') k, value #>> '{}' v from jsonb_each(p_utm)
             where jsonb_typeof(value) = 'string') s
     where k in ('source','medium','campaign','term','content') and length(v) > 0;
  end if;
  if jsonb_typeof(p_click_ids) = 'object' then
    select coalesce(jsonb_object_agg(key, left(value #>> '{}', 200)), '{}') into v_clicks
      from jsonb_each(p_click_ids)
     where key in ('gclid','fbclid','li_fat_id','msclkid') and jsonb_typeof(value) = 'string';
  end if;

  -- throttle: 5 submissions per email per hour, 300 per workspace per 10 minutes
  if (select count(*) from public.lead_events e join public.leads l on l.id = e.lead_id
       where l.workspace_id = w.id and lower(l.email) = v_email and e.event_name = 'form_submit'
         and e.occurred_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.lead_events e
          where e.workspace_id = w.id and e.event_name = 'form_submit'
            and e.occurred_at > now() - interval '10 minutes') >= 300 then
    raise exception 'too many submissions, try later' using errcode = '54000';
  end if;

  v_subject  := encode(sha256(convert_to(v_email, 'UTF8')), 'hex');
  v_personal := split_part(v_email, '@', 2) in ('gmail.com','googlemail.com','yahoo.com','yahoo.co.in','outlook.com',
                  'hotmail.com','live.com','rediffmail.com','icloud.com','proton.me','protonmail.com');
  v_src := lower(coalesce(v_utm->>'source', ''));
  v_med := lower(coalesce(v_utm->>'medium', ''));
  v_channel := case
                 when v_src = 'linkedin' then 'linkedin'
                 when v_src in ('facebook','instagram','meta','fb','ig') then 'meta'
                 when v_src in ('google','gads','adwords') then
                   case when v_med in ('cpc','paid','ppc','search') or v_src <> 'google' then 'google_ads' else 'organic' end
                 when v_src = 'whatsapp' then 'whatsapp'
                 when v_src in ('email','mailchimp','newsletter') or v_med = 'email' then 'email'
                 when v_src = 'referral' or v_med = 'referral' then 'referral'
                 when v_src in ('event','webinar') then 'event'
                 when v_src = '' then 'direct'
                 else 'other'
               end::public.channel_kind;
  select id into v_campaign from public.campaigns where workspace_id = w.id and utm_campaign = v_utm->>'campaign';

  -- transparent rule-based score (never presented as an AI prediction)
  select coalesce(jsonb_agg(jsonb_build_object('factor', f, 'label', l, 'points', p)), '[]'), coalesce(sum(p), 0)
    into v_factors, v_score
    from (values
      ('role_owner',     'Managing partner / owner',        40, v_role = 'Managing partner / owner'),
      ('role_senior',    'Senior advocate / practice head', 25, v_role = 'Senior advocate / practice head'),
      ('role_associate', 'Associate / lawyer',              10, v_role = 'Associate / lawyer'),
      ('work_email',     'Work email domain',               15, not v_personal),
      ('phone_given',    'Phone number shared',              5, v_phone is not null),
      ('whatsapp_optin', 'WhatsApp opt-in',                  5, coalesce(p_consent_whatsapp, false))
    ) x(f, l, p, hit)
   where hit;

  select id into v_lead from public.leads
   where workspace_id = w.id and lower(email) = v_email and deleted_at is null;

  if v_lead is null and v_firm is not null and length(v_firm) > 1 then   -- accounts only for new leads (anti-spam)
    select id into v_account from public.accounts
     where workspace_id = w.id and lower(name) = lower(v_firm)
       and lower(coalesce(city,'')) = lower(coalesce(v_city,'')) and deleted_at is null;
    if v_account is null then
      insert into public.accounts (workspace_id, name, city, district)
      values (w.id, v_firm, v_city, v_district)
      returning id into v_account;
    end if;
  end if;

  if v_lead is null then
    insert into public.leads (workspace_id, full_name, email, phone, role_title, firm_name, account_id, city, district,
                              practice_area, personal_email, campaign_id, first_touch_channel, first_touch_campaign,
                              last_touch_channel, last_touch_campaign, utm, click_ids, landing_path, source,
                              consent_demo_followup, consent_whatsapp, consent_marketing, score, score_factors)
    values (w.id, v_name, v_email, v_phone, v_role, v_firm, v_account, v_city, v_district, v_practice, v_personal,
            v_campaign, v_channel, v_utm->>'campaign', v_channel, v_utm->>'campaign', v_utm, v_clicks, v_path,
            'landing', true, coalesce(p_consent_whatsapp,false), coalesce(p_consent_marketing,false),
            least(v_score, 100), v_factors)
    returning id into v_lead;
  else
    -- repeat submission: keep first touch, refresh last touch. The consent flags are NOT touched here (PRIV-012): they follow consent_log
    -- through the trigger in this migration, so a person who withdrew is only re-opted-in by a new granted row below.
    update public.leads
       set last_touch_channel = v_channel, last_touch_campaign = v_utm->>'campaign',
           phone = coalesce(phone, v_phone)
     where id = v_lead;
  end if;

  insert into public.lead_events (workspace_id, lead_id, anon_id, event_name, utm, path)
  values (w.id, v_lead, v_anon, 'form_submit', v_utm, v_path);
  if v_anon is not null then
    update public.lead_events set lead_id = v_lead
     where workspace_id = w.id and anon_id = v_anon and lead_id is null;
  end if;

  insert into public.consent_log (workspace_id, lead_id, subject_ref, purpose, action, notice_version, captured_via, notice_sha256, form_id, ip_hash, ua_class)
  select w.id, v_lead, v_subject, x.purpose, 'granted', v_notice, 'landing_form', v_notice_sha, v_form, v_ip_hash, v_ua
    from (values ('demo_followup'::public.consent_purpose, true),
                 ('whatsapp'::public.consent_purpose, coalesce(p_consent_whatsapp,false)),
                 ('marketing_email'::public.consent_purpose, coalesce(p_consent_marketing,false))) x(purpose, given)
   where x.given;

  return v_lead;
end $$;

revoke all on function public.submit_lead(text, text, text, text, text, text, text, text, text, boolean, boolean, boolean, text, jsonb, jsonb, text, text, text, text, text) from public;
grant execute on function public.submit_lead(text, text, text, text, text, text, text, text, text, boolean, boolean, boolean, text, jsonb, jsonb, text, text, text, text, text) to anon, authenticated;

-- ---------- 5. privacy_tokens: single-use / bounded-use tokens, hash at rest ----------
-- purpose verify: the sealed intake link (one use). It is not stored when mailed; privacy_token_use(..., p_register => true) registers it on
--   first use, so a second use finds the row spent. purpose status: a read-only status link, bounded views. purpose export: the delivery link
--   for an access bundle, one download. The token itself is never stored, only its sha256.
create table if not exists public.privacy_tokens (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  request_id     uuid references public.privacy_requests(id) on delete cascade,
  purpose        text not null check (purpose in ('verify', 'status', 'export')),
  token_hash     text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  max_uses       int not null default 1 check (max_uses between 1 and 50),
  uses           int not null default 0 check (uses >= 0),
  expires_at     timestamptz not null,
  first_used_at  timestamptz,
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint privacy_tokens_uses_le_max check (uses <= max_uses)
);
create unique index if not exists privacy_tokens_hash on public.privacy_tokens (token_hash);
create index if not exists privacy_tokens_request on public.privacy_tokens (request_id) where request_id is not null;
create index if not exists privacy_tokens_workspace on public.privacy_tokens (workspace_id);
create index if not exists privacy_tokens_expires on public.privacy_tokens (expires_at);
create index if not exists privacy_tokens_created_by on public.privacy_tokens (created_by) where created_by is not null;
alter table public.privacy_tokens enable row level security;   -- no policy, no grant: service role only
revoke all on public.privacy_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.privacy_tokens to service_role;

-- Atomic use. Returns {ok, reason, request_id}. reason: unknown | revoked | expired | used | scope.
-- p_register true (verify links): create the row on first sight, expiring at p_expires, one use.
create or replace function public.privacy_token_use(p_hash text, p_purpose text, p_workspace uuid, p_expires timestamptz default null, p_register boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_req uuid; v_row public.privacy_tokens;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_purpose not in ('verify', 'status', 'export') then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  select w.tenant_id into v_tenant from public.workspaces w where w.id = p_workspace;
  if v_tenant is null then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  if p_register then
    insert into public.privacy_tokens (tenant_id, workspace_id, purpose, token_hash, max_uses, expires_at)
    values (v_tenant, p_workspace, p_purpose, p_hash, 1, coalesce(p_expires, now() + interval '24 hours'))
    on conflict (token_hash) do nothing;
  end if;
  update public.privacy_tokens t set uses = t.uses + 1, last_used_at = now(), first_used_at = coalesce(t.first_used_at, now())
   where t.token_hash = p_hash and t.purpose = p_purpose and t.workspace_id = p_workspace
     and t.revoked_at is null and t.expires_at > now() and t.uses < t.max_uses
  returning t.request_id into v_req;
  if found then return jsonb_build_object('ok', true, 'reason', null, 'request_id', v_req); end if;
  select * into v_row from public.privacy_tokens t where t.token_hash = p_hash;
  if v_row.id is null then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  if v_row.purpose <> p_purpose or v_row.workspace_id <> p_workspace then return jsonb_build_object('ok', false, 'reason', 'scope'); end if;
  return jsonb_build_object('ok', false, 'reason', case when v_row.revoked_at is not null then 'revoked' when v_row.expires_at <= now() then 'expired' else 'used' end);
end $$;
revoke all on function public.privacy_token_use(text, text, uuid, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.privacy_token_use(text, text, uuid, timestamptz, boolean) to service_role;

-- Read-only state of a token, for the confirmation page (a GET must not spend it). Same reasons as privacy_token_use plus 'fresh' (never seen).
create or replace function public.privacy_token_peek(p_hash text, p_purpose text, p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_row public.privacy_tokens;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_row from public.privacy_tokens t where t.token_hash = p_hash;
  if v_row.id is null then return jsonb_build_object('state', 'fresh'); end if;
  if v_row.purpose <> p_purpose or v_row.workspace_id <> p_workspace then return jsonb_build_object('state', 'scope'); end if;
  return jsonb_build_object('state', case when v_row.revoked_at is not null then 'revoked' when v_row.expires_at <= now() then 'expired'
                                         when v_row.uses >= v_row.max_uses then 'used' else 'ok' end, 'request_id', v_row.request_id);
end $$;
revoke all on function public.privacy_token_peek(text, text, uuid) from public, anon, authenticated;
grant execute on function public.privacy_token_peek(text, text, uuid) to service_role;

-- Housekeeping, called by the daily sweep: spent or expired tokens are dropped 30 days after they stopped being usable.
create or replace function public.privacy_tokens_purge() returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.privacy_tokens t where t.expires_at < now() - interval '30 days' or (t.uses >= t.max_uses and t.last_used_at < now() - interval '30 days');
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.privacy_tokens_purge() from public, anon, authenticated;
grant execute on function public.privacy_tokens_purge() to service_role;

-- ---------- 6. alerts: event types and the daily sweep ----------
insert into public.event_types (type, domain, description, webhook_eligible, agent_eligible) values
  ('privacy.request_received', 'privacy', 'A data-subject request was confirmed by the requester', false, false),
  ('privacy.request_due_soon', 'privacy', 'An open data-subject request is within 5 days of its due date', false, false),
  ('privacy.request_overdue', 'privacy', 'An open data-subject request is past its due date', false, false)
on conflict (type) do nothing;

-- The sweep (src/lib/privacy/job.ts, kind privacy.dsr_due) writes in-app notifications for the workspace owners at due-5d and at due+0.
-- Enabled: it only reads open requests and writes notifications. It needs the app version that registers the handler (deploy first).
insert into public.scheduled_jobs (tenant_id, workspace_id, kind, cron, tz, payload, enabled)
select null, null, 'privacy.dsr_due', '30 8 * * *', 'Asia/Kolkata', '{}'::jsonb, true
 where not exists (select 1 from public.scheduled_jobs where kind = 'privacy.dsr_due' and tenant_id is null and workspace_id is null);

-- ---------- 7. erase_lead: a real ledger entry (PRIV-028) ----------
create or replace function public.erase_lead(p_lead uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.leads; v_ref text;
begin
  select * into l from public.leads where id = p_lead;
  if l.id is null or l.workspace_id not in (select public.member_role_ws_ids('owner')) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  -- PRIV-028: the ledger needs the person's real subject reference, read BEFORE the address is wiped
  select c.subject_ref into v_ref from public.consent_log c where c.lead_id = p_lead order by c.id desc limit 1;
  if v_ref is null then
    v_ref := encode(sha256(convert_to(case when l.email is not null then lower(l.email) else 'lead:' || p_lead::text end, 'UTF8')), 'hex');
  end if;
  perform set_config('app.actor_label', 'erasure', true);
  update public.leads set full_name = 'Erased lead', email = null, phone = null, firm_name = null,
         utm = '{}', click_ids = '{}', score_factors = '[]', external_ids = '{}', deleted_at = coalesce(deleted_at, now())
   where id = p_lead;
  update public.activities set body = null, subject = null where lead_id = p_lead;
  update public.messages m set body = null from public.conversations c
   where c.id = m.conversation_id and c.lead_id = p_lead;
  update public.lead_events set props = '{}', anon_id = null where lead_id = p_lead;
  delete from public.ai_insights where lead_id = p_lead;
  -- one erasure_completed row per purpose the person ever had a row for (demo_followup when there is none), so every purpose ends in the ledger
  insert into public.consent_log (workspace_id, lead_id, subject_ref, purpose, action, notice_version, captured_via, recorded_by, note, form_id)
  select l.workspace_id, p_lead, v_ref, p.purpose, 'erasure_completed', 'n/a', 'request', auth.uid(), left(p_note, 200), 'erase_lead'
    from (select distinct c.purpose from public.consent_log c where c.lead_id = p_lead
          union select 'demo_followup'::public.consent_purpose where not exists (select 1 from public.consent_log c where c.lead_id = p_lead)) p;
end $$;
