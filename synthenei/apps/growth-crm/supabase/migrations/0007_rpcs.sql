-- 0007 RPCs for the workspace model: landing intake (anon), workspace switcher, invites, platform admin.
-- All SECURITY DEFINER with search_path = '' and explicit authorisation inside; EXECUTE grants in 0009.

-- ---------- defaults for a new workspace (internal) ----------
create or replace function public.seed_workspace_defaults(p_ws uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.pipeline_stages (workspace_id, key, label, position, probability, max_days, is_won, is_lost) values
    (p_ws, 'discovery',      'Discovery',       1, 10, 14, false, false),
    (p_ws, 'demo_scheduled', 'Demo scheduled',  2, 25, 10, false, false),
    (p_ws, 'demo_done',      'Demo done',       3, 40, 14, false, false),
    (p_ws, 'proposal',       'Proposal sent',   4, 60, 14, false, false),
    (p_ws, 'negotiation',    'Negotiation',     5, 80, 21, false, false),
    (p_ws, 'won',            'Won',             6, 100, 999, true, false),
    (p_ws, 'lost',           'Lost',            7, 0, 999, false, true)
  on conflict do nothing;
  insert into public.integrations (workspace_id, provider, label, category, direction, status, auth_method) values
    (p_ws, 'zoho_crm',   'Zoho CRM',             'crm',        'both', 'showcase', 'OAuth 2.0 (accounts.zoho.in)'),
    (p_ws, 'hubspot',    'HubSpot',              'crm',        'both', 'showcase', 'OAuth 2.0 / private app token'),
    (p_ws, 'whatsapp',   'WhatsApp Business',    'messaging',  'both', 'showcase', 'System user token'),
    (p_ws, 'linkedin',   'LinkedIn Lead Gen',    'ads',        'in',   'showcase', 'OAuth 2.0'),
    (p_ws, 'meta_ads',   'Meta Ads',             'ads',        'both', 'showcase', 'System user token'),
    (p_ws, 'google_ads', 'Google Ads',           'ads',        'both', 'showcase', 'OAuth 2.0 + developer token'),
    (p_ws, 'ga4',        'Google Analytics 4',   'analytics',  'both', 'showcase', 'Service account'),
    (p_ws, 'mailchimp',  'Mailchimp',            'email',      'in',   'showcase', 'API key / OAuth 2.0'),
    (p_ws, 'gmail',      'Gmail',                'email',      'both', 'showcase', 'OAuth 2.0 (restricted scopes)'),
    (p_ws, 'outlook',    'Outlook',              'email',      'both', 'showcase', 'OAuth 2.0 (Microsoft Graph)'),
    (p_ws, 'calendly',   'Calendly',             'scheduling', 'in',   'showcase', 'OAuth 2.0 / personal token'),
    (p_ws, 'calcom',     'Cal.com',              'scheduling', 'in',   'showcase', 'API key'),
    (p_ws, 'slack',      'Slack',                'automation', 'out',  'showcase', 'Incoming webhook'),
    (p_ws, 'zapier',     'Zapier',               'automation', 'both', 'showcase', 'Signed webhooks'),
    (p_ws, 'make',       'Make',                 'automation', 'both', 'showcase', 'Signed webhooks'),
    (p_ws, 'razorpay',   'Razorpay',             'payments',   'in',   'showcase', 'Key + webhook secret'),
    (p_ws, 'landing',    'Landing page',         'internal',   'in',   'not_configured', 'submit_lead RPC'),
    (p_ws, 'csv',        'CSV import',           'internal',   'in',   'connected', 'User session')
  on conflict do nothing;
$$;

-- ---------- branding for the login page (no personal data) ----------
create or replace function public.tenant_branding(p_slug text default null, p_domain text default null)
returns table (tenant_id uuid, slug text, brand_name text, brand_logo_url text, brand_logo_dark_url text,
               brand_favicon_url text, brand_primary text, brand_accent text, support_email text, is_demo boolean)
language sql stable security definer set search_path = '' as $$
  select t.id, t.slug, t.brand_name, t.brand_logo_url, t.brand_logo_dark_url, t.brand_favicon_url,
         t.brand_primary, t.brand_accent, t.support_email, t.is_demo
    from public.tenants t
   where t.status = 'active'
     and ((p_slug is not null and t.slug = p_slug) or (p_domain is not null and t.custom_domain = lower(p_domain)))
   limit 1
$$;

-- ---------- landing intake (anon) ----------
-- p_workspace: workspace slug (e.g. 'lawsome-tn') or id. The landing app sends NEXT_PUBLIC_LEAD_WORKSPACE.
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

create or replace function public.track_event(
  p_workspace text, p_anon_id text, p_event_name text,
  p_path text default null, p_utm jsonb default '{}', p_props jsonb default '{}'
) returns void
language plpgsql security definer set search_path = '' as $$
declare ws_id uuid;
begin
  select ws.id into ws_id from public.workspaces ws
   where (ws.slug = p_workspace or ws.id::text = p_workspace) and ws.lead_intake_enabled and ws.archived_at is null;
  if ws_id is null then raise exception 'unknown workspace' using errcode = '22023'; end if;
  if p_event_name not in ('page_view','cta_click','form_start','tour_play','pricing_view','demo_booked') then
    raise exception 'event not allowed' using errcode = '22023'; end if;
  if p_anon_id is null or length(p_anon_id) not between 8 and 64 then
    raise exception 'anon_id required (consented visitors only)' using errcode = '22023'; end if;
  if pg_column_size(p_props) > 2000 or pg_column_size(p_utm) > 2000 then
    raise exception 'payload too large' using errcode = '22023'; end if;
  if (select count(*) from public.lead_events
       where workspace_id = ws_id and anon_id = p_anon_id and occurred_at > now() - interval '1 minute') >= 60 then
    return;  -- silently drop floods
  end if;
  insert into public.lead_events (workspace_id, lead_id, anon_id, event_name, utm, path, props)
  values (ws_id, (select lead_id from public.lead_events
                   where workspace_id = ws_id and anon_id = p_anon_id and lead_id is not null limit 1),
          p_anon_id, p_event_name, coalesce(p_utm,'{}'), left(p_path, 300), coalesce(p_props,'{}'));
end $$;

-- ---------- DPDP erasure: real workspace owner only (never via a support session) ----------
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

-- ---------- workspace switcher ----------
create or replace function public.my_workspaces()
returns table (workspace_id uuid, workspace_name text, workspace_slug text, region_label text, is_demo boolean,
               tenant_id uuid, tenant_name text, tenant_slug text, branding jsonb, role public.app_role,
               via_support_session boolean, support_session_expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with mine as (
    select m.workspace_id, m.role, false as via_ss, null::timestamptz as ss_expires
      from public.memberships m where m.user_id = auth.uid() and m.is_active
    union all
    select s.workspace_id, (case s.mode when 'read_write' then 'owner' else 'viewer' end)::public.app_role, true, s.expires_at
      from public.support_sessions s
     where s.admin_id = auth.uid() and s.ended_at is null and now() < s.expires_at and public.is_platform_admin()
  )
  select w.id, w.name, w.slug, w.region_label, w.is_demo, t.id, t.name, t.slug,
         jsonb_build_object('brand_name', t.brand_name, 'brand_logo_url', t.brand_logo_url,
                            'brand_logo_dark_url', t.brand_logo_dark_url, 'brand_favicon_url', t.brand_favicon_url,
                            'brand_primary', t.brand_primary, 'brand_accent', t.brand_accent,
                            'support_email', t.support_email),
         mine.role, mine.via_ss, mine.ss_expires
    from mine join public.workspaces w on w.id = mine.workspace_id join public.tenants t on t.id = w.tenant_id
   where w.archived_at is null and t.status = 'active'
   order by t.name, w.name
$$;

-- ---------- membership / invitation (internal, no auth check; callers authorise) ----------
create or replace function public._add_member_or_invite(p_ws uuid, p_email text, p_role public.app_role,
                                                       p_full_name text, p_districts text[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_inv uuid; v_email text := lower(trim(p_email));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' or length(v_email) > 160 then
    raise exception 'invalid email' using errcode = '22023'; end if;
  select u.id into v_user from auth.users u where lower(u.email) = v_email and u.email_confirmed_at is not null;
  if v_user is not null then
    insert into public.profiles (id, full_name, email, last_workspace_id)
    values (v_user, coalesce(nullif(trim(p_full_name), ''), split_part(v_email, '@', 1)), v_email, p_ws)
    on conflict (id) do nothing;
    insert into public.memberships (user_id, workspace_id, role, invited_by)
    values (v_user, p_ws, p_role, auth.uid())
    on conflict (user_id, workspace_id) do update set role = excluded.role, is_active = true;
    insert into public.territories (workspace_id, district, rep_id)
    select p_ws, d, v_user from unnest(coalesce(p_districts, '{}')) d
    on conflict (workspace_id, district) do update set rep_id = excluded.rep_id;
    if p_role = 'owner' then
      update public.tenants t set primary_owner_id = v_user
       where t.id = (select w.tenant_id from public.workspaces w where w.id = p_ws) and t.primary_owner_id is null;
    end if;
    return jsonb_build_object('status', 'member_added', 'user_id', v_user);
  end if;
  delete from public.invitations where workspace_id = p_ws and lower(email) = v_email and accepted_at is null;
  insert into public.invitations (workspace_id, email, full_name, role, territory_districts, invited_by)
  values (p_ws, v_email, nullif(trim(p_full_name), ''), p_role, coalesce(p_districts, '{}'),
          (select p.id from public.profiles p where p.id = auth.uid()))
  returning id into v_inv;
  -- the server action must now call auth.admin.inviteUserByEmail(email) with the service role
  return jsonb_build_object('status', 'invited', 'invitation_id', v_inv);
end $$;

-- Owner: any role. Sales manager: sales_rep / viewer only. Platform admin: only to seat the OWNER of a workspace
-- that has no active owner (bootstrap from /admin/tenants/[id]); otherwise admins must use a support session
-- like everyone else, so a second account cannot be used to bypass the support-session model.
create or replace function public.invite_member(p_ws uuid, p_email text, p_role public.app_role,
                                                p_full_name text default null, p_districts text[] default '{}')
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not (p_ws in (select public.member_role_ws_ids('owner'))
          or (p_ws in (select public.member_role_ws_ids('sales_manager')) and p_role in ('sales_rep','viewer'))
          or (public.is_platform_admin() and p_role = 'owner'
              and not exists (select 1 from public.memberships m
                               where m.workspace_id = p_ws and m.role = 'owner' and m.is_active))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return public._add_member_or_invite(p_ws, p_email, p_role, p_full_name, p_districts);
end $$;

-- Tenant owners (owner in any workspace of the tenant) and platform admins.
create or replace function public.create_workspace(p_tenant uuid, p_name text, p_slug text default null,
                                                   p_region_label text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_slug text;
begin
  if not (p_tenant in (select public.owner_tenant_ids()) or public.is_platform_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_slug := coalesce(nullif(trim(p_slug), ''),
                     trim(both '-' from left(regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'), 40)));
  insert into public.workspaces (tenant_id, name, slug, region_label, is_demo)
  values (p_tenant, trim(p_name), v_slug, nullif(trim(p_region_label), ''),
          (select t.is_demo from public.tenants t where t.id = p_tenant))
  returning id into v_ws;
  perform public.seed_workspace_defaults(v_ws);
  if p_tenant in (select public.owner_tenant_ids()) then
    insert into public.memberships (user_id, workspace_id, role, invited_by) values (auth.uid(), v_ws, 'owner', auth.uid());
  end if;
  return v_ws;
end $$;

-- Platform admin: new white-label tenant + first workspace + owner seat (member or invitation).
create or replace function public.admin_create_tenant(p_name text, p_slug text, p_branding jsonb,
                                                      p_owner_email text, p_workspace_name text default 'Main')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_t uuid; v_ws uuid; v_owner jsonb; b jsonb := coalesce(p_branding, '{}');
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.tenants (slug, name, brand_name, brand_logo_url, brand_primary, brand_accent, support_email,
                              email_sender_name, is_demo)
  values (p_slug, trim(p_name), coalesce(b->>'brand_name', trim(p_name)), b->>'brand_logo_url',
          coalesce(b->>'brand_primary', '#1D5FBF'), coalesce(b->>'brand_accent', '#0F8B8D'),
          b->>'support_email', b->>'email_sender_name', coalesce((b->>'is_demo')::boolean, false))
  returning id into v_t;
  insert into public.workspaces (tenant_id, name, slug, is_demo)
  values (v_t, p_workspace_name,
          left(p_slug || '-' || trim(both '-' from regexp_replace(lower(p_workspace_name), '[^a-z0-9]+', '-', 'g')), 40),
          coalesce((b->>'is_demo')::boolean, false))
  returning id into v_ws;
  perform public.seed_workspace_defaults(v_ws);
  v_owner := public._add_member_or_invite(v_ws, p_owner_email, 'owner', null, '{}');
  return jsonb_build_object('tenant_id', v_t, 'workspace_id', v_ws, 'owner', v_owner);
end $$;

-- ---------- audited break-glass access ----------
create or replace function public.start_support_session(p_workspace_id uuid, p_reason text, p_mode text default 'read_only',
                                                        p_minutes int default 30)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_minutes not in (15, 30, 60) then raise exception 'duration must be 15, 30 or 60 minutes' using errcode = '22023'; end if;
  update public.support_sessions set ended_at = now()
   where admin_id = auth.uid() and ended_at is null;                   -- one open session per admin
  insert into public.support_sessions (admin_id, workspace_id, reason, mode, expires_at)
  values (auth.uid(), p_workspace_id, trim(p_reason), p_mode, now() + make_interval(mins => p_minutes))
  returning id into v_id;
  return v_id;
end $$;

-- End by session id, or every open session of the caller in a workspace (p_workspace_id), or all of the caller's.
create or replace function public.end_support_session(p_id uuid default null, p_workspace_id uuid default null) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.support_sessions set ended_at = now()
   where ended_at is null and admin_id = auth.uid()
     and (p_id is null or id = p_id) and (p_workspace_id is null or workspace_id = p_workspace_id);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- platform admin console (aggregates only, no personal data) ----------
create or replace function public.admin_workspace_stats()
returns table (tenant_id uuid, tenant_name text, tenant_status text, workspace_id uuid, workspace_name text,
               workspace_slug text, members int, leads_total int, leads_30d int, integrations_attention int,
               failed_syncs_24h int, last_activity_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select t.id, t.name, t.status, w.id, w.name, w.slug,
         (select count(*)::int from public.memberships m where m.workspace_id = w.id and m.is_active),
         (select count(*)::int from public.leads l where l.workspace_id = w.id and l.deleted_at is null),
         (select count(*)::int from public.leads l where l.workspace_id = w.id and l.deleted_at is null
            and l.created_at > now() - interval '30 days'),
         (select count(*)::int from public.integrations i where i.workspace_id = w.id
            and i.status in ('needs_attention','error')),
         (select count(*)::int from public.sync_runs r where r.workspace_id = w.id and r.status = 'failed'
            and r.started_at > now() - interval '24 hours'),
         greatest((select max(a.created_at) from public.activities a where a.workspace_id = w.id),
                  (select max(l.created_at) from public.leads l where l.workspace_id = w.id))
    from public.workspaces w join public.tenants t on t.id = w.tenant_id
   order by t.name, w.name;
end $$;

create or replace function public.admin_set_tenant_status(p_tenant uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status not in ('active','suspended','archived') then raise exception 'invalid status' using errcode = '22023'; end if;
  update public.tenants set status = p_status where id = p_tenant;
end $$;
-- Granting/revoking platform admin is deliberately SQL-only (service role), see README.
