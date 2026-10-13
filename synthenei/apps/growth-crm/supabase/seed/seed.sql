-- Growth CRM demo seed (synthetic, deterministic). Loads into a project without the demo tenants; to rebuild,
-- run seed/reset_demo.sql first (it deletes the demo tenants, which cascades to all their rows).
-- Tenants: LAWSOME (workspaces lawsome-tn "LAWSOME · Tamil Nadu", lawsome-kl "LAWSOME · Kerala pilot") and
-- Kaveri LegalTech (demo) (workspace kaveri-cbe "Kaveri · Coimbatore") to demonstrate isolation.
-- All people and firms are fictional; emails use .example domains; phone numbers are deliberately invalid
-- (+91 00000 xxxxx). Dates are relative to the day the seed runs (IST). Pseudo-randomness is hash-based, so the
-- same rows come out every time. Owners (owner_id) stay empty: there are no auth users in a fresh project.
-- After inviting users, run seed/assign_owners.sql to spread leads/deals/tasks across the workspace's reps.
-- Run as postgres/service role (SQL editor or MCP execute_sql). Never run against a production tenant.

begin;
select set_config('app.actor_label', 'seed', true);


-- ---------- tenants + workspaces (fixed ids, see README) ----------
insert into public.tenants (id, slug, name, brand_name, brand_primary, brand_accent, support_email, email_sender_name, is_demo, plan)
values ('10000000-0000-4000-8000-000000000001', 'lawsome', 'LAWSOME', 'LAWSOME Growth', '#1D5FBF', '#0F8B8D',
        'support@lawsome.example', 'LAWSOME Growth', true, 'demo'),
       ('10000000-0000-4000-8000-000000000002', 'kaveri-demo', 'Kaveri LegalTech (demo)', 'Kaveri Growth', '#0F7B6C', '#B7791F',
        'help@kaveri-legaltech.example', 'Kaveri Growth', true, 'demo');

insert into public.workspaces (id, tenant_id, name, slug, region_label, is_demo, sla_first_response_mins)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'LAWSOME · Tamil Nadu',  'lawsome-tn', 'Tamil Nadu', true, 120),
       ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'LAWSOME · Kerala pilot', 'lawsome-kl', 'Kerala',     true, 240),
       ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'Kaveri · Coimbatore',    'kaveri-cbe', 'Kongu belt', true, 180);

select public.seed_workspace_defaults(id) from public.workspaces where slug in ('lawsome-tn','lawsome-kl','kaveri-cbe');

-- ---------- firms (accounts) ----------
create temp table seed_firms (ws text, k int, name text, city text, locality text, district text, practices text[]) on commit drop;
insert into seed_firms values
 ('lawsome-tn', 1,'Ramanathan & Associates','Chennai','Mylapore','Chennai','{civil,property}'),
 ('lawsome-tn', 2,'Cauvery Delta Legal LLP','Chennai','T. Nagar','Chennai','{corporate,tax}'),
 ('lawsome-tn', 3,'Marina Law Partners','Chennai','Egmore','Chennai','{civil,criminal}'),
 ('lawsome-tn', 4,'Srinivasan Law Chambers','Chennai','Mylapore','Chennai','{property,family}'),
 ('lawsome-tn', 5,'Arcot Road Chambers','Chennai','T. Nagar','Chennai','{criminal}'),
 ('lawsome-tn', 6,'Venkatraman & Co. Advocates','Chennai','Egmore','Chennai','{civil,labour}'),
 ('lawsome-tn', 7,'Lakshmi Narayanan Legal','Chennai','Anna Nagar','Chennai','{family,civil}'),
 ('lawsome-tn', 8,'Thillai Law Associates','Chennai','Anna Nagar','Chennai','{property,civil}'),
 ('lawsome-tn', 9,'Pallavan Legal Partners','Chennai','Egmore','Chennai','{corporate,labour}'),
 ('lawsome-tn',10,'Santhome Law Offices','Chennai','Mylapore','Chennai','{family,property}'),
 ('lawsome-tn',11,'Rajaratnam Chambers','Chennai','T. Nagar','Chennai','{tax,corporate}'),
 ('lawsome-tn',12,'Natarajan & Sekar Advocates','Chennai','Egmore','Chennai','{criminal,civil}'),
 ('lawsome-tn',13,'Coromandel Legal LLP','Chennai','Anna Nagar','Chennai','{corporate,tax,labour}'),
 ('lawsome-tn',14,'Krishnaswamy Law Group','Chennai','T. Nagar','Chennai','{civil,property,tax}'),
 ('lawsome-tn',15,'Elango & Partners','Chennai','Mylapore','Chennai','{labour,civil}'),
 ('lawsome-tn',16,'Bharathi Legal Associates','Chennai','Anna Nagar','Chennai','{criminal,family}'),
 ('lawsome-tn',17,'Kovai Legal Associates','Coimbatore','R.S. Puram','Coimbatore','{civil,property}'),
 ('lawsome-tn',18,'Noyyal Law Chambers','Coimbatore','Gandhipuram','Coimbatore','{labour,corporate}'),
 ('lawsome-tn',19,'Palaniappan & Co.','Coimbatore','Race Course','Coimbatore','{tax,corporate}'),
 ('lawsome-tn',20,'Siruvani Advocates','Coimbatore','Saibaba Colony','Coimbatore','{family,civil}'),
 ('lawsome-tn',21,'Velusamy Law Offices','Coimbatore','R.S. Puram','Coimbatore','{property}'),
 ('lawsome-tn',22,'Kongu Legal Partners','Coimbatore','Peelamedu','Coimbatore','{corporate,labour}'),
 ('lawsome-tn',23,'Annamalai & Associates','Coimbatore','Gandhipuram','Coimbatore','{criminal,civil}'),
 ('lawsome-tn',24,'Vaigai Advocates','Madurai','K.K. Nagar','Madurai','{civil,criminal}'),
 ('lawsome-tn',25,'Pandian Law Chambers','Madurai','Anna Nagar','Madurai','{property,civil}'),
 ('lawsome-tn',26,'Alagar Legal Associates','Madurai','Tallakulam','Madurai','{family,criminal}'),
 ('lawsome-tn',27,'Sellur Law Offices','Madurai','Sellur','Madurai','{labour}'),
 ('lawsome-tn',28,'Mariappan & Co.','Madurai','K.K. Nagar','Madurai','{tax,civil}'),
 ('lawsome-tn',29,'Tamukkam Chambers','Madurai','Tallakulam','Madurai','{criminal}'),
 ('lawsome-tn',30,'Rockfort Chambers','Tiruchirappalli','Cantonment','Tiruchirappalli','{civil,property}'),
 ('lawsome-tn',31,'Kollidam Legal','Tiruchirappalli','Thillai Nagar','Tiruchirappalli','{family,civil}'),
 ('lawsome-tn',32,'Srirangam Law Associates','Tiruchirappalli','Srirangam','Tiruchirappalli','{property}'),
 ('lawsome-tn',33,'Uraiyur Advocates','Tiruchirappalli','Thillai Nagar','Tiruchirappalli','{criminal,labour}'),
 ('lawsome-tn',34,'Shevaroy Legal','Salem','Fairlands','Salem','{corporate,civil}'),
 ('lawsome-tn',35,'Yercaud Road Chambers','Salem','Hasthampatti','Salem','{property,family}'),
 ('lawsome-tn',36,'Thirumanimuthar Law Offices','Salem','Fairlands','Salem','{civil}'),
 ('lawsome-tn',37,'Ramasamy & Partners','Salem','Swarnapuri','Salem','{tax,labour}'),
 ('lawsome-tn',38,'Thamirabarani Law Offices','Tirunelveli','Palayamkottai','Tirunelveli','{civil,property}'),
 ('lawsome-tn',39,'Nellai Legal Associates','Tirunelveli','Palayamkottai','Tirunelveli','{criminal,family}'),
 ('lawsome-tn',40,'Kuttalam Chambers','Tirunelveli','Vannarpettai','Tirunelveli','{civil}'),
 ('lawsome-kl', 1,'Periyar Law Chambers','Kochi','Kaloor','Ernakulam','{civil,commercial}'),
 ('lawsome-kl', 2,'Ananthapuri Advocates','Thiruvananthapuram','Vanchiyoor','Thiruvananthapuram','{criminal,family}'),
 ('lawsome-kl', 3,'Malabar Legal Partners','Kozhikode','Mavoor Road','Kozhikode','{property,civil}'),
 ('lawsome-kl', 4,'Vadakkunnathan Law Offices','Thrissur','Round North','Thrissur','{family,mact}'),
 ('kaveri-cbe', 1,'Bhavani Law Associates','Coimbatore','R.S. Puram','Coimbatore','{civil,property}'),
 ('kaveri-cbe', 2,'Tiruppur Textile Legal','Tiruppur','Kumaran Road','Tiruppur','{commercial,labour}'),
 ('kaveri-cbe', 3,'Amaravathi Chambers','Coimbatore','Peelamedu','Coimbatore','{criminal,ni_138}');

insert into public.accounts (id, workspace_id, name, city, district, address_line, court_focus, practice_areas, size_band,
                             lawyers_count, clerks_count, sites, current_tools, website, customer_status, is_synthetic, created_at)
select md5('acct-' || f.ws || '-' || f.k)::uuid, w.id, f.name, f.city, f.district, f.locality || ', ' || f.city,
       case when f.city = 'Chennai' then '{madras_hc,district}'::text[]
            when f.district in ('Madurai','Tiruchirappalli','Tirunelveli') then '{madurai_bench,district}'::text[]
            when f.ws = 'lawsome-kl' then '{district}'::text[]
            else '{district,madras_hc}'::text[] end,
       f.practices,
       (array['solo','2-5','6-20','6-20','21-50','2-5','50+'])[1 + (f.k * 5) % 7],
       (array[1, 4, 9, 14, 32, 3, 64])[1 + (f.k * 5) % 7],
       (array[1, 2, 4, 6, 12, 2, 20])[1 + (f.k * 5) % 7],
       case when (f.k * 5) % 7 in (4, 6) then jsonb_build_array(jsonb_build_object('label', f.locality || ' HQ', 'city', f.city),
                                                              jsonb_build_object('label', 'High Court chamber', 'city', case when f.district in ('Madurai','Tiruchirappalli','Tirunelveli') then 'Madurai' else 'Chennai' end))
            else jsonb_build_array(jsonb_build_object('label', f.locality || ' office', 'city', f.city)) end,
       (array['Excel + WhatsApp groups','Paper diary + clerk','Generic case diary app','Excel + Google Drive','Tally + Excel'])[1 + f.k % 5],
       'https://' || regexp_replace(lower(f.name), '[^a-z0-9]+', '', 'g') || '.example',
       case when f.k in (3, 13, 24) then 'customer'::public.customer_status when f.k in (17, 30) then 'trial' else 'prospect' end,
       true, now() - make_interval(days => 120 - f.k)
  from seed_firms f join public.workspaces w on w.slug = f.ws;

-- ---------- campaigns (utm ids identical to the UI mock catalog) ----------
create temp table seed_campaigns (ws text, k int, name text, channel public.channel_kind, status text, objective text,
  src text, med text, utm text, start_off int, end_off int, daily int, budget numeric) on commit drop;
insert into seed_campaigns values
 ('lawsome-tn',1,'Hearing-day visibility — Chennai partners','linkedin','active','Demo requests from managing partners','linkedin','paid_social','li_hearing_day_chn',-78,null,4100,320000),
 ('lawsome-tn',2,'eCourts made easy — Madurai advocates','whatsapp','active','Conversations with Madurai Bench practitioners','whatsapp','message','wa_ecourts_mdu',-62,null,1300,85000),
 ('lawsome-tn',3,'Ask Nidhi launch — Mailchimp','email','ended','Re-engage dormant leads with the Ask Nidhi research assistant','email','email','em_ask_nidhi_launch',-44,-12,650,22000),
 ('lawsome-tn',4,'Coimbatore firms — Meta lead ads','meta','active','Lead form submissions from Coimbatore & Tiruppur firms','meta','paid_social','meta_kovai_firms',-56,null,3900,240000),
 ('lawsome-tn',5,'Google Search — legal practice software','google_ads','active','High-intent search demand across Tamil Nadu','google','cpc','gads_practice_sw',-89,null,3800,360000),
 ('lawsome-tn',6,'Cause-list alerts — Trichy & Salem','whatsapp','paused','Test WhatsApp alerts offer outside Chennai','whatsapp','message','wa_causelist_try_slm',-36,-9,1100,40000),
 ('lawsome-tn',7,'DPDP for law firms — partner webinar','linkedin','ended','Webinar registrations, then demo follow-up','linkedin','paid_social','li_dpdp_webinar',-88,-52,3000,110000),
 ('lawsome-tn',8,'Site retargeting — Meta','meta','active','Bring back pricing-page visitors','meta','paid_social','meta_retarget_pricing',-30,null,2600,90000),
 ('lawsome-kl',1,'Kerala pilot — Kochi partners (LinkedIn)','linkedin','active','Pilot demand test in Ernakulam','linkedin','paid_social','li_kochi_pilot',-28,null,1800,50000),
 ('kaveri-cbe',1,'Kaveri — Tiruppur commercial firms (Meta)','meta','active','Lead forms from Kongu belt firms','meta','paid_social','meta_kaveri_tpr',-40,null,1500,60000);

insert into public.campaigns (id, workspace_id, name, channel, status, objective, utm_source, utm_medium, utm_campaign,
                              starts_on, ends_on, budget_inr, is_synthetic, notes)
select md5('cmp-' || c.ws || '-' || c.k)::uuid, w.id, c.name, c.channel, c.status, c.objective, c.src, c.med, c.utm,
       current_date + c.start_off, case when c.end_off is null then null else current_date + c.end_off end, c.budget, true,
       'Synthetic demo campaign'
  from seed_campaigns c join public.workspaces w on w.slug = c.ws;

insert into public.campaign_daily_metrics (workspace_id, campaign_id, day, spend_inr, impressions, reach, clicks, reactions,
                                           comments, shares, opens, bounces, unsubscribes, platform_leads, source)
select w.id, md5('cmp-' || c.ws || '-' || c.k)::uuid, d::date,
       case when c.channel = 'email' then round(c.daily * 0.15)
            else round(c.daily * (0.75 + (abs(hashtext(c.utm || d::text)) % 50) / 100.0)) end,
       x.impr, round(x.impr * 0.62), greatest(1, round(x.impr * x.ctr)),
       case when c.channel in ('linkedin','meta') then round(x.impr * 0.004) else 0 end,
       case when c.channel in ('linkedin','meta') then round(x.impr * 0.0006) else 0 end,
       case when c.channel in ('linkedin','meta') then round(x.impr * 0.0003) else 0 end,
       case when c.channel in ('email','whatsapp') then round(x.impr * case when c.channel = 'email' then 0.34 else 0.81 end) else 0 end,
       case when c.channel = 'email' then round(x.impr * 0.012) else 0 end,
       case when c.channel = 'email' then round(x.impr * 0.002) else 0 end,
       (abs(hashtext('pl' || c.utm || d::text)) % case c.channel when 'meta' then 4 when 'linkedin' then 3 when 'google_ads' then 3 else 2 end),
       'mock'
  from seed_campaigns c
  join public.workspaces w on w.slug = c.ws
  cross join lateral generate_series(current_date + c.start_off, coalesce(current_date + c.end_off, current_date - 1), interval '1 day') d
  cross join lateral (select
       (case c.channel when 'linkedin' then 5200 when 'meta' then 9800 when 'google_ads' then 2100
                       when 'email' then case when (d::date - (current_date + c.start_off)) % 8 = 0 then 1700 else 0 end
                       else 260 end)
         * (80 + abs(hashtext('im' || c.utm || d::text)) % 40) / 100 as impr,
       case c.channel when 'linkedin' then 0.0065 when 'meta' then 0.011 when 'google_ads' then 0.052
                      when 'email' then 0.041 else 0.09 end as ctr) x
 where x.impr > 0 or c.channel <> 'email';

-- ---------- leads ----------
create temp table seed_leads on commit drop as
with ws as (
  select w.id as ws_id, w.slug, n.n_leads, (select count(*) from seed_firms f where f.ws = w.slug) as n_firms
    from public.workspaces w
    join (values ('lawsome-tn', 120), ('lawsome-kl', 15), ('kaveri-cbe', 10)) n(slug, n_leads) on n.slug = w.slug
), base as (
  select ws.ws_id, ws.slug, i, f.k as firm_k, f.name as firm, f.city, f.district, f.practices,
         (array['Karthikeyan','Saravanan','Lakshmi','Revathi','Senthil','Gayathri','Murugan','Deepa','Vignesh','Sangeetha',
                'Balaji','Kavitha','Prakash','Anitha','Ramesh','Janani','Ganesh','Bhuvana','Harish','Nandhini',
                'Selvam','Priyadharshini','Arvind','Malathi','Dinesh','Shalini','Mohan','Keerthana','Suresh','Vidhya',
                'Rajesh','Hema','Kumaran','Sowmya','Elango','Abirami','Thirumalai','Pavithra','Ilango','Yamuna'])[1 + (i * 7 + length(ws.slug)) % 40] as first,
         (array['Subramanian','Krishnan','Natarajan','Ramasamy','Palanisamy','Venkatesan','Murugesan','Rajendran','Shanmugam',
                'Balasubramanian','Chandrasekaran','Ganesan','Raghavan','Thangaraj','Kannan','Periyasamy','Arumugam','Selvaraj'])[1 + (i * 11) % 18] as last,
         (array['Managing partner / owner','Managing partner / owner','Managing partner / owner','Managing partner / owner',
                'Senior advocate / practice head','Senior advocate / practice head','Senior advocate / practice head',
                'Associate / lawyer','Associate / lawyer','Associate / lawyer','Legal operations / admin','Legal operations / admin','Other'])[1 + (i * 5) % 13] as role_title,
         (array['email','linkedin','linkedin','meta','meta','whatsapp','whatsapp','google','google','google','referral','direct','linkedin','meta','email','google','whatsapp','referral','direct','google'])[1 + (i * 13) % 20] as src,
         1 + (i * 37) % 88 as age_days,
         abs(hashtext('lead' || ws.slug || i)) % 100 as h
    from ws
    cross join lateral generate_series(1, ws.n_leads) i
    join seed_firms f on f.ws = ws.slug and f.k = 1 + ((i * 7) % ws.n_firms)
)
select b.*,
       md5('lead-' || b.slug || '-' || b.i)::uuid as lead_id,
       md5('acct-' || b.slug || '-' || b.firm_k)::uuid as account_id,
       case b.src
         when 'linkedin' then case when b.city = 'Chennai' then 'li_hearing_day_chn' when b.slug = 'lawsome-kl' then 'li_kochi_pilot' else 'li_dpdp_webinar' end
         when 'whatsapp' then case when b.district in ('Tiruchirappalli','Salem') then 'wa_causelist_try_slm' else 'wa_ecourts_mdu' end
         when 'meta'     then case when b.slug = 'kaveri-cbe' then 'meta_kaveri_tpr' when b.city = 'Coimbatore' then 'meta_kovai_firms' else 'meta_retarget_pricing' end
         when 'google'   then 'gads_practice_sw'
         when 'email'    then 'em_ask_nidhi_launch'
       end as utm_campaign,
       case b.src when 'linkedin' then 'paid_social' when 'meta' then 'paid_social' when 'google' then 'cpc'
                  when 'whatsapp' then 'message' when 'email' then 'email' when 'referral' then 'referral' end as utm_medium,
       case b.src when 'linkedin' then 'linkedin' when 'meta' then 'meta' when 'google' then 'google_ads'
                  when 'whatsapp' then 'whatsapp' when 'email' then 'email' when 'referral' then 'referral' else 'direct' end::public.channel_kind as channel,
       (now() at time zone 'Asia/Kolkata')::date - b.age_days + make_interval(hours => 9 + b.h % 10, mins => (b.i * 7) % 60) as created_ist,
       case when b.age_days <= 5 then 'new'
            when b.h < 33 then 'contacted' when b.h < 55 then 'qualified' when b.h < 70 then 'nurturing'
            when b.h < 80 then 'disqualified' else 'converted' end::public.lead_status as status,
       b.h % 7 = 0 as personal
  from base b;

-- campaigns that only exist in another workspace must not be referenced
update seed_leads l set utm_campaign = null, utm_medium = null
 where utm_campaign is not null
   and not exists (select 1 from seed_campaigns c where c.ws = l.slug and c.utm = l.utm_campaign);

insert into public.leads (id, workspace_id, full_name, email, phone, role_title, firm_name, account_id, city, district,
                          practice_area, personal_email, status, disqualify_reason, campaign_id, first_touch_channel,
                          first_touch_campaign, last_touch_channel, last_touch_campaign, utm, landing_path, source,
                          consent_demo_followup, consent_whatsapp, consent_marketing, score, score_factors,
                          first_response_at, last_touch_at, next_step_at, is_synthetic, created_at)
select l.lead_id, l.ws_id,
       case when l.role_title in ('Managing partner / owner','Senior advocate / practice head') then 'Adv. ' else '' end || l.first || ' ' || l.last,
       lower(l.first) || '.' || lower(left(l.last, 6)) || l.i || '@' ||
         case when l.personal then 'mail.example' else regexp_replace(lower(l.firm), '[^a-z0-9]+', '', 'g') || '.example' end,
       case when l.h % 3 = 0 then '+91 00000 ' || lpad((l.i * 97 % 100000)::text, 5, '0') end,
       l.role_title, l.firm, l.account_id, l.city, l.district, l.practices[1], l.personal, l.status,
       case when l.status = 'disqualified' then (array['not_a_fit','in_house_excel','no_decision'])[1 + l.i % 3] end,
       (select c.id from public.campaigns c where c.workspace_id = l.ws_id and c.utm_campaign = l.utm_campaign),
       l.channel, l.utm_campaign,
       case when l.h % 5 = 0 then 'email'::public.channel_kind else l.channel end,
       case when l.h % 5 = 0 and l.slug = 'lawsome-tn' then 'em_ask_nidhi_launch' else l.utm_campaign end,
       case when l.src = 'direct' then '{}'::jsonb
            else jsonb_strip_nulls(jsonb_build_object('source', l.src, 'medium', l.utm_medium, 'campaign', l.utm_campaign)) end,
       (array['/','/demo','/pricing','/ask-nidhi','/ecourts'])[1 + l.i % 5], 'landing',
       true, l.h % 2 = 0, l.h % 3 <> 0,
       least(100, (case l.role_title when 'Managing partner / owner' then 40 when 'Senior advocate / practice head' then 25
                                     when 'Associate / lawyer' then 10 else 0 end)
                  + case when l.personal then 0 else 15 end + case when l.h % 3 = 0 then 5 else 0 end
                  + case when l.h % 2 = 0 then 5 else 0 end
                  + case when l.status in ('qualified','converted') then 20 else 0 end),
       (select jsonb_agg(jsonb_build_object('factor', f, 'label', lb, 'points', p))
          from (values ('role', l.role_title, case l.role_title when 'Managing partner / owner' then 40
                         when 'Senior advocate / practice head' then 25 when 'Associate / lawyer' then 10 else 0 end),
                       ('work_email', 'Work email domain', case when l.personal then 0 else 15 end),
                       ('phone_given', 'Phone number shared', case when l.h % 3 = 0 then 5 else 0 end),
                       ('whatsapp_optin', 'WhatsApp opt-in', case when l.h % 2 = 0 then 5 else 0 end),
                       ('demo_booked', 'Demo booked', case when l.status in ('qualified','converted') then 20 else 0 end)) x(f, lb, p)
         where p > 0),
       case when l.status <> 'new' then (l.created_ist at time zone 'Asia/Kolkata') + make_interval(mins => 12 + (l.i * 53) % 400) end,
       case when l.status <> 'new' then (l.created_ist at time zone 'Asia/Kolkata') + make_interval(days => least(l.age_days - 1, 1 + l.i % 9)) end,
       case when l.status in ('new','contacted','qualified','nurturing') then now() + make_interval(days => (l.i % 9) - 3, hours => l.i % 6) end,
       true, l.created_ist at time zone 'Asia/Kolkata'
  from seed_leads l;

-- consent records for every form lead (subject_ref = sha256(lower(email)))
insert into public.consent_log (workspace_id, lead_id, subject_ref, purpose, action, notice_version, captured_via, occurred_at)
select l.workspace_id, l.id, encode(sha256(convert_to(lower(l.email), 'UTF8')), 'hex'), x.purpose, 'granted', 'v1', 'landing_form', l.created_at
  from public.leads l
  cross join lateral (values ('demo_followup'::public.consent_purpose, true),
                             ('whatsapp'::public.consent_purpose, l.consent_whatsapp),
                             ('marketing_email'::public.consent_purpose, l.consent_marketing)) x(purpose, given)
 where l.is_synthetic and x.given
   and l.workspace_id in (select id from public.workspaces where slug in ('lawsome-tn','lawsome-kl','kaveri-cbe'));
insert into public.consent_log (workspace_id, lead_id, subject_ref, purpose, action, notice_version, captured_via, occurred_at, note)
select l.workspace_id, l.id, encode(sha256(convert_to(lower(l.email), 'UTF8')), 'hex'), 'marketing_email', 'withdrawn', 'v1', 'request',
       l.created_at + interval '20 days', 'Unsubscribed from newsletter (synthetic)'
  from public.leads l join public.workspaces w on w.id = l.workspace_id and w.slug = 'lawsome-tn'
 where l.consent_marketing and l.created_at < now() - interval '25 days' and abs(hashtext(l.id::text)) % 9 = 0;

-- ---------- funnel events: one journey per lead + consented anonymous visitors ----------
insert into public.lead_events (workspace_id, lead_id, anon_id, event_name, utm, path, occurred_at)
select l.workspace_id, l.id, 'anon-' || left(md5(l.id::text), 16), e.name, l.utm, l.landing_path,
       l.created_at - e.before
  from public.leads l
  cross join lateral (values ('page_view', interval '9 minutes'), ('cta_click', interval '6 minutes'),
                             ('form_start', interval '4 minutes'), ('form_submit', interval '0 minutes')) e(name, before)
 where l.is_synthetic and l.workspace_id in (select id from public.workspaces where slug in ('lawsome-tn','lawsome-kl','kaveri-cbe'));
insert into public.lead_events (workspace_id, lead_id, anon_id, event_name, path, occurred_at)
select l.workspace_id, l.id, 'anon-' || left(md5(l.id::text), 16), 'tour_play', '/demo', l.created_at + interval '2 minutes'
  from public.leads l where l.is_synthetic and abs(hashtext(l.id::text)) % 4 = 0
   and l.workspace_id in (select id from public.workspaces where slug in ('lawsome-tn','lawsome-kl','kaveri-cbe'));

insert into public.lead_events (workspace_id, anon_id, event_name, utm, path, occurred_at)
select w.id, 'anon-v' || w.slug || '-' || d::date || '-' || v, ev.name,
       case when v % 4 = 0 then '{"source":"google","medium":"cpc","campaign":"gads_practice_sw"}'::jsonb
            when v % 4 = 1 then '{"source":"linkedin","medium":"paid_social"}'::jsonb else '{}'::jsonb end,
       (array['/','/pricing','/ask-nidhi','/ecourts','/demo'])[1 + v % 5],
       d + make_interval(hours => 8 + v % 12, mins => (v * 13) % 60)
  from public.workspaces w
  cross join lateral generate_series(current_date - 89, current_date - 1, interval '1 day') d
  cross join lateral generate_series(1, case w.slug when 'lawsome-tn' then 22 + abs(hashtext(w.slug || d::text)) % 26
                                                   else 3 + abs(hashtext(w.slug || d::text)) % 5 end) v
  cross join lateral (select 'page_view' as name
                      union all select 'cta_click' where v % 3 = 0
                      union all select 'form_start' where v % 9 = 0
                      union all select 'pricing_view' where v % 5 = 1) ev
 where w.slug in ('lawsome-tn','lawsome-kl','kaveri-cbe');

-- ---------- deals (25 in Tamil Nadu, a few elsewhere) ----------
create temp table seed_deals on commit drop as
select * from (
select l.id as lead_id, l.workspace_id, l.account_id, l.firm_name, l.created_at, w.slug,
       row_number() over (partition by l.workspace_id order by abs(hashtext('deal' || l.id::text))) as r
  from public.leads l join public.workspaces w on w.id = l.workspace_id
 where l.is_synthetic and l.status in ('qualified','converted','nurturing')
   and w.slug in ('lawsome-tn','lawsome-kl','kaveri-cbe')
) x where (slug = 'lawsome-tn' and r <= 25) or (slug <> 'lawsome-tn' and r <= 3);

insert into public.deals (id, workspace_id, name, account_id, lead_id, stage_id, stage_entered_at, value_inr, seats, plan,
                          expected_close_on, next_step, next_step_at, objections, lost_reason, competitor, won_at,
                          is_synthetic, created_at)
select md5('deal-' || d.lead_id)::uuid, d.workspace_id,
       d.firm_name || ' — ' || initcap(x.plan) || ' plan, ' || x.seats || ' seats',
       d.account_id, d.lead_id, s.id,
       d.created_at + make_interval(days => 3 + d.r::int % 12),
       x.seats * x.per_seat, x.seats, x.plan,
       current_date + (d.r::int * 3) % 45 - 5,
       case when x.stage not in ('won','lost') then (array['Send proposal','Schedule demo','Partner sign-off call','Share security note','Trial review'])[1 + d.r::int % 5] end,
       case when x.stage not in ('won','lost') then now() + make_interval(days => d.r::int % 8) end,
       case when d.r % 3 = 0 then '{price}'::text[] when d.r % 5 = 0 then '{ai_accuracy,data_security}'::text[]
            when d.r % 7 = 0 then '{ecourts_reliability}'::text[] else '{}'::text[] end,
       case when x.stage = 'lost' then (array['price','competitor','no_decision','in_house_excel'])[1 + d.r::int % 4] end,
       case when x.stage = 'lost' and d.r % 2 = 0 then 'Generic case diary app' end,
       case when x.stage = 'won' then d.created_at + make_interval(days => 18 + d.r::int % 20) end,
       true, d.created_at + interval '2 days'
  from seed_deals d
  cross join lateral (select
       case when d.slug <> 'lawsome-tn' then (array['discovery','demo_scheduled','proposal'])[d.r]
            else (array['won','won','won','won','won','lost','lost','lost','lost','negotiation','negotiation','negotiation',
                        'proposal','proposal','proposal','proposal','demo_done','demo_done','demo_done','demo_done',
                        'demo_scheduled','demo_scheduled','demo_scheduled','discovery','discovery'])[d.r] end as stage,
       (array[3, 5, 8, 12, 4, 18, 6, 25, 9, 40, 7, 15, 10])[1 + d.r::int % 13] as seats,
       (array[14400, 17400, 21600, 28800, 16800, 36000])[1 + (d.r::int * 7) % 6] as per_seat,
       case when (array[3, 5, 8, 12, 4, 18, 6, 25, 9, 40, 7, 15, 10])[1 + d.r::int % 13] >= 20 then 'enterprise'
            when (array[3, 5, 8, 12, 4, 18, 6, 25, 9, 40, 7, 15, 10])[1 + d.r::int % 13] >= 8 then 'chambers'
            else 'practice' end as plan) x
  join public.pipeline_stages s on s.workspace_id = d.workspace_id and s.key = x.stage;

-- won deals: the firm becomes a customer
update public.accounts a set customer_status = 'customer'
  from public.deals d where d.account_id = a.id and d.won_at is not null and d.is_synthetic;

-- ---------- activities ----------
insert into public.activities (workspace_id, kind, lead_id, account_id, deal_id, direction, outcome, meeting_type,
                               scheduled_at, duration_mins, subject, body, done_at, source, created_at)
select l.workspace_id, a.kind, l.id, l.account_id, (select d.id from public.deals d where d.lead_id = l.id),
       a.direction, a.outcome, a.meeting_type,
       case when a.kind = 'meeting' then l.first_response_at + interval '3 days' end,
       case when a.kind = 'call' then 4 + abs(hashtext(l.id::text)) % 14 when a.kind = 'meeting' then 40 end,
       a.subject, a.body,
       case when a.kind = 'meeting' and l.first_response_at + interval '3 days' > now() then null
            else l.first_response_at + a.offs end,
       'simulated', l.first_response_at + a.offs
  from public.leads l
  cross join lateral (values
     ('call'::public.activity_kind, 'outbound'::public.msg_direction, 'connected', null::text, 'Intro call',
      'Discussed hearing-day workflow and cause-list tracking. Interested in a demo for partners.', interval '0 minutes', 0),
     ('whatsapp', 'outbound', null, null, 'Demo link shared', 'Shared demo slot options and the Ask Nidhi overview.', interval '1 day', 1),
     ('email', 'outbound', null, null, 'Follow-up: pricing and DPDP note', 'Sent pricing placeholder and the data-security note.', interval '2 days', 2),
     ('meeting', 'outbound', null, 'demo', 'Product demo', 'Demo of matter diary, eCourts sync and team calendar.', interval '3 days', 3),
     ('note', null, null, null, 'Internal note', 'Partner prefers Tamil-language WhatsApp updates.', interval '4 days', 4)
  ) a(kind, direction, outcome, meeting_type, subject, body, offs, step)
 where l.is_synthetic and l.first_response_at is not null
   and a.step <= case l.status when 'contacted' then 1 when 'nurturing' then 2 when 'disqualified' then 0
                               when 'qualified' then 3 when 'converted' then 4 else 0 end
   and l.workspace_id in (select id from public.workspaces where slug in ('lawsome-tn','lawsome-kl','kaveri-cbe'));

-- ---------- tasks ----------
insert into public.tasks (workspace_id, lead_id, deal_id, title, kind, priority, due_at, status, completed_at, created_at)
select l.workspace_id, l.id, (select d.id from public.deals d where d.lead_id = l.id),
       t.title || ': ' || l.firm_name, t.kind, 1 + abs(hashtext('p' || l.id::text)) % 3,
       now() + make_interval(days => (abs(hashtext('t' || l.id::text)) % 11) - 4, hours => abs(hashtext(l.id::text)) % 8),
       case when abs(hashtext('s' || l.id::text)) % 4 = 0 then 'done' else 'open' end::public.task_status,
       case when abs(hashtext('s' || l.id::text)) % 4 = 0 then now() - interval '1 day' end,
       l.created_at + interval '1 day'
  from public.leads l
  cross join lateral (select (array['Call back','Send proposal','Share demo recording','WhatsApp follow-up','Prepare demo'])[1 + abs(hashtext('k' || l.id::text)) % 5] as title,
                             (array['call','proposal','email','whatsapp','demo_prep'])[1 + abs(hashtext('k' || l.id::text)) % 5] as kind) t
 where l.is_synthetic and l.status in ('new','contacted','qualified','nurturing')
   and l.workspace_id in (select id from public.workspaces where slug in ('lawsome-tn','lawsome-kl','kaveri-cbe'))
   and abs(hashtext('task' || l.id::text)) % 5 < 3;

-- ---------- GA4 (mock feed, 90 days) ----------
insert into public.ga4_daily (workspace_id, day, channel_group, source_medium, device_category, sessions, engaged_sessions,
                              total_users, new_users, avg_engagement_secs, key_events, source)
select w.id, d::date, c.grp, c.sm, dev.name, x.sessions, round(x.sessions * c.eng), round(x.sessions * 0.86),
       round(x.sessions * 0.71), c.secs * dev.f, round(x.sessions * c.kr), 'mock'
  from public.workspaces w
  cross join generate_series(current_date - 90, current_date - 1, interval '1 day') d
  cross join (values ('Organic Search','google / organic',0.61,74.0,0.010,42),('Paid Search','google / cpc',0.55,61.0,0.024,38),
                     ('Paid Social','linkedin / paid_social',0.43,38.0,0.012,30),('Paid Social','meta / paid_social',0.38,29.0,0.009,46),
                     ('Email','email / email',0.66,88.0,0.016,12),('Direct','(direct) / (none)',0.58,70.0,0.008,26),
                     ('Referral','referral / referral',0.69,96.0,0.020,6),('Organic Social','whatsapp / message',0.52,47.0,0.011,10)) c(grp, sm, eng, secs, kr, base)
  cross join (values ('mobile', 0.68, 0.85), ('desktop', 0.32, 1.25)) dev(name, share, f)
  cross join lateral (select greatest(1, round(c.base * dev.share * case w.slug when 'lawsome-tn' then 1 else 0.12 end
                              * (85 + abs(hashtext(w.slug || c.sm || d::text)) % 30) / 100.0
                              * case when extract(isodow from d) = 7 then 0.55 else 1 end)) as sessions) x
 where w.slug in ('lawsome-tn','lawsome-kl','kaveri-cbe');

-- ---------- integrations: showcase cards fed by sample data ----------
update public.integrations i
   set settings = jsonb_build_object('sample_feed', true),
       last_sync_at = now() - make_interval(mins => 20 + abs(hashtext(i.provider)) % 600)
  from public.workspaces w
 where w.id = i.workspace_id and w.slug in ('lawsome-tn','lawsome-kl','kaveri-cbe')
   and i.provider in ('ga4','linkedin','meta_ads','google_ads','mailchimp','whatsapp','zoho_crm','calendly');
update public.integrations i set status = 'needs_attention', last_error = 'Sample: token expires in 5 days (re-auth needed)'
  from public.workspaces w where w.id = i.workspace_id and w.slug = 'lawsome-tn' and i.provider = 'meta_ads';
update public.integrations i set status = 'connected', last_sync_at = now() - interval '7 minutes'
  from public.workspaces w where w.id = i.workspace_id and w.slug in ('lawsome-tn','lawsome-kl','kaveri-cbe') and i.provider = 'landing';

insert into public.integration_field_maps (workspace_id, integration_id, external_object, external_field, local_table,
                                           local_column, direction, transform, conflict_owner, sample_value)
select i.workspace_id, i.id, m.obj, m.fld, m.tbl, m.col, m.dir, m.tf, m.co, m.sample
  from public.integrations i join public.workspaces w on w.id = i.workspace_id and w.slug = 'lawsome-tn'
  join (values ('zoho_crm','Leads','Last_Name','leads','full_name','both',null,'crm','Subramanian'),
               ('zoho_crm','Leads','Lead_Source','leads','first_touch_channel','in','channel_map','external','LinkedIn'),
               ('zoho_crm','Deals','Stage','deals','stage_id','both','stage_key_map','crm','Proposal/Price Quote'),
               ('zoho_crm','Deals','Amount','deals','value_inr','both',null,'crm','172800'),
               ('zoho_crm','Accounts','Account_Name','accounts','name','both',null,'crm','Rockfort Chambers'),
               ('hubspot','contacts','phone','contacts','phone','in','e164_phone','external','+91 00000 00000'),
               ('razorpay','payment','amount','deals','value_inr','in','inr_paise_to_rupees','external','17280000')
       ) m(provider, obj, fld, tbl, col, dir, tf, co, sample) on m.provider = i.provider;

insert into public.sync_runs (workspace_id, integration_id, kind, started_at, finished_at, status, rows_in, rows_out, rows_rejected, error)
select i.workspace_id, i.id, r.kind, now() - r.ago, now() - r.ago + interval '42 seconds', r.status, r.rin, r.rout, r.rej, r.err
  from public.integrations i join public.workspaces w on w.id = i.workspace_id and w.slug = 'lawsome-tn'
  join (values ('ga4','poll',interval '3 hours','success'::public.sync_status,1240,0,0,null),
               ('ga4','poll',interval '27 hours','success',1188,0,0,null),
               ('linkedin','csv',interval '2 days','partial',214,0,6,'6 rows rejected: missing campaign id (sample)'),
               ('meta_ads','poll',interval '5 hours','failed',0,0,0,'Sample: OAuth token near expiry'),
               ('meta_ads','poll',interval '29 hours','success',96,0,0,null),
               ('google_ads','poll',interval '4 hours','success',88,0,0,null),
               ('mailchimp','webhook',interval '12 hours','success',37,0,0,null),
               ('landing','webhook',interval '7 minutes','success',1,0,0,null),
               ('zoho_crm','outbound',interval '6 hours','success',0,18,0,null),
               ('whatsapp','webhook',interval '9 hours','success',22,0,0,null),
               ('csv','csv',interval '6 days','success',58,0,2,null),
               ('calendly','webhook',interval '1 day','success',3,0,0,null)) r(provider, kind, ago, status, rin, rout, rej, err)
    on r.provider = i.provider;

-- ---------- backups: heartbeat rows (project-wide, workspace_id null) ----------
insert into public.backup_checks (workspace_id, checked_at, check_kind, status, backup_taken_at, size_bytes, retention_days,
                                  pitr_enabled, location, row_counts, detail)
select null::uuid, (current_date - k) + time '03:30', 'supabase_daily', 'success', (current_date - k) + time '02:10',
       null, 7, false, 'demo:supabase-managed', null, 'Supabase daily backup observed (no official status API; recorded by backup job)'
  from generate_series(0, 13) k
union all
select null, (current_date - k) + time '02:20', 'logical_dump',
       case when k = 9 then 'failed' else 'success' end::public.backup_status,
       case when k = 9 then null else (current_date - k) + time '02:05' end,
       case when k = 9 then null else 18400000 + (13 - k) * 152000 end, 30, false, 'demo:offsite:crm-dumps',
       case when k = 9 then null else jsonb_build_object('leads', 145 - k, 'deals', 31, 'activities', 260 - k, 'lead_events', 9000 - k * 40) end,
       case when k = 9 then 'pg_dump exited 1: connection reset (synthetic incident)' else 'nightly pg_dump, gzip, encrypted' end
  from generate_series(0, 13) k
union all
select null, current_date - 41 + time '11:00', 'restore_drill', 'success', current_date - 42 + time '02:05', 17900000, null, null,
       'demo:scratch-db', null, 'Quarterly restore drill: row counts matched (synthetic)'
union all
select null, now() - interval '10 minutes', 'heartbeat', 'success', null, null, null, null, 'demo:uptime', null, '/api/health ok';

insert into public.backup_alert_rules (workspace_id, name, check_kind, condition, max_age_hours, max_size_drop_pct, notify_to)
values (null, 'Nightly dump missing', 'logical_dump', 'no success in 26h', 26, null, 'demo:slack #ops'),
       (null, 'Dump size drop', 'logical_dump', 'size dropped more than 20% vs 7-day median', null, 20, 'demo:slack #ops'),
       (null, 'Restore drill overdue', 'restore_drill', 'no success in 100 days', 2400, null, 'demo:email owner');

commit;
