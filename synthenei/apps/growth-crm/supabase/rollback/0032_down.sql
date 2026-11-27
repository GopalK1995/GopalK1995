-- ROLLBACK for 0032_consent_evidence_dsr_workflow.sql. Manual, one transaction. NOT applied by any agent.
-- DATA LOSS: consent evidence (notice hash, form id, ip hash, ua class), notice text snapshots and the token ledger are dropped.
-- Run the app rollback FIRST (an app that still sends p_form_id would get PGRST202 and fall back, so order is forgiving either way).
-- Flags repaired by the one-off update in 0032 stay as they are (they were wrong before).
begin;
drop trigger if exists consent_log_flag_sync on public.consent_log;
drop function if exists private.consent_flag_sync();
drop function if exists public.consent_flag_mismatches(uuid);
drop function if exists public.privacy_token_use(text, text, uuid, timestamptz, boolean);
drop function if exists public.privacy_token_peek(text, text, uuid);
drop function if exists public.privacy_tokens_purge();
drop table if exists public.privacy_tokens;
delete from public.scheduled_jobs where kind = 'privacy.dsr_due' and tenant_id is null and workspace_id is null;
delete from public.event_types where type in ('privacy.request_received', 'privacy.request_due_soon', 'privacy.request_overdue');
drop function if exists public.submit_lead(text, text, text, text, text, text, text, text, text, boolean, boolean, boolean, text, jsonb, jsonb, text, text, text, text, text);
-- original submit_lead and erase_lead (0007_rpcs.sql)
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
  p_landing_path       text default null
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
    -- repeat submission: keep first touch, refresh last touch and consents
    update public.leads
       set last_touch_channel = v_channel, last_touch_campaign = v_utm->>'campaign',
           phone = coalesce(phone, v_phone),
           consent_demo_followup = true,
           consent_whatsapp  = consent_whatsapp  or coalesce(p_consent_whatsapp,false),
           consent_marketing = consent_marketing or coalesce(p_consent_marketing,false)
     where id = v_lead;
  end if;

  insert into public.lead_events (workspace_id, lead_id, anon_id, event_name, utm, path)
  values (w.id, v_lead, v_anon, 'form_submit', v_utm, v_path);
  if v_anon is not null then
    update public.lead_events set lead_id = v_lead
     where workspace_id = w.id and anon_id = v_anon and lead_id is null;
  end if;

  insert into public.consent_log (workspace_id, lead_id, subject_ref, purpose, action, notice_version, captured_via)
  select w.id, v_lead, v_subject, x.purpose, 'granted', v_notice, 'landing_form'
    from (values ('demo_followup'::public.consent_purpose, true),
                 ('whatsapp'::public.consent_purpose, coalesce(p_consent_whatsapp,false)),
                 ('marketing_email'::public.consent_purpose, coalesce(p_consent_marketing,false))) x(purpose, given)
   where x.given;

  return v_lead;
end $$;

create or replace function public.erase_lead(p_lead uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.leads;
begin
  select * into l from public.leads where id = p_lead;
  if l.id is null or l.workspace_id not in (select public.member_role_ws_ids('owner')) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  perform set_config('app.actor_label', 'erasure', true);
  update public.leads set full_name = 'Erased lead', email = null, phone = null, firm_name = null,
         utm = '{}', click_ids = '{}', score_factors = '[]', external_ids = '{}', deleted_at = coalesce(deleted_at, now())
   where id = p_lead;
  update public.activities set body = null, subject = null where lead_id = p_lead;
  update public.messages m set body = null from public.conversations c
   where c.id = m.conversation_id and c.lead_id = p_lead;
  update public.lead_events set props = '{}', anon_id = null where lead_id = p_lead;
  delete from public.ai_insights where lead_id = p_lead;
  insert into public.consent_log (workspace_id, lead_id, subject_ref, purpose, action, notice_version, captured_via, recorded_by, note)
  select l.workspace_id, p_lead, coalesce((select subject_ref from public.consent_log where lead_id = p_lead limit 1), 'unknown'),
         'demo_followup', 'erasure_completed', 'n/a', 'request', auth.uid(), left(p_note, 200);
end $$;

grant execute on function public.submit_lead(text, text, text, text, text, text, text, text, text, boolean, boolean, boolean, text, jsonb, jsonb, text, text) to anon, authenticated;
alter table public.consent_log drop constraint if exists consent_log_notice_fk, drop constraint if exists consent_log_evidence_shape;
drop index if exists public.consent_log_notice;
alter table public.consent_log drop column if exists notice_sha256, drop column if exists form_id, drop column if exists ip_hash, drop column if exists ua_class;
drop trigger if exists notice_versions_append_only on public.notice_versions;
drop function if exists private.notice_versions_append_only();
drop table if exists public.notice_versions;
commit;
