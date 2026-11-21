-- Batch 5 gate: catalogue + availability, stating the TRUE gate. Nothing is 'live': no connector has been exercised against its real vendor.
-- Rule: production = disabled; staging/demo = sandbox where the connector ships a Showcase/fixture gateway, else disabled.
insert into public.connector_catalog (id, name, category, auth_kind, verticals, gate, sandbox_supported, docs_url) values
  ('ical', 'Calendar feeds (iCal)', 'ota', 'api_key', '{hospitality}', 'none', true, null),
  ('channel-manager', 'Channel manager', 'ota', 'api_key', '{hospitality}', 'needs_vendor_approval', true, null)
on conflict (id) do nothing;
update public.connector_catalog set sandbox_supported = true where id in ('gmail', 'google-calendar', 'google-business');
update public.connector_catalog set sandbox_supported = true, gate = 'needs_vendor_approval' where id = 'outlook';
update public.connector_catalog set auth_kind = 'api_key', gate = 'none' where id = 'calendly';
update public.connector_catalog set auth_kind = 'none', sandbox_supported = false where id in ('zapier', 'make');

insert into public.connector_availability (connector_id, env, mode, gate_status, note)
select c.id, e.env,
       case when e.env = 'production' or not c.sandbox_supported then 'disabled' else 'sandbox' end,
       case c.gate when 'none' then 'ready' else c.gate end,
       case c.id
         when 'gmail' then 'Restricted scope: testing mode (max 100 named test users) until CASA completes'
         when 'google-calendar' then 'Sensitive scope: Google OAuth app verification pending; not tried against Google'
         when 'google-business' then 'Business Profile API access must be granted by Google per Cloud project'
         when 'linkedin' then 'Marketing Developer Platform approval needed; not tried against LinkedIn'
         when 'outlook' then 'Microsoft publisher verification pending; not tried against Microsoft'
         when 'slack' then 'Needs the Slack app client id and secret; not tried against Slack'
         when 'calendly' then 'Built to the vendor docs, not yet tried with a real Calendly token'
         when 'cal-com' then 'Built to the vendor docs, not yet tried with a real Cal.com key'
         when 'ical' then 'Not yet tried against real Airbnb or Booking.com feeds'
         when 'channel-manager' then 'Partner not chosen (B-6); fixtures only'
         when 'zapier' then 'Zapier app not pushed or published; REST API keys work today'
         when 'make' then 'Make app not imported or published; REST API keys work today'
       end
  from public.connector_catalog c cross join (values ('production'), ('staging'), ('demo')) e(env)
 where c.id in ('linkedin','google-business','google-calendar','gmail','outlook','calendly','cal-com','slack','zapier','make','ical','channel-manager')
on conflict (connector_id, env) do update set mode = excluded.mode, gate_status = excluded.gate_status, note = excluded.note;
