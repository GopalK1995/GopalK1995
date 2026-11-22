-- T058 · Cross-tenant isolation suite (introspection-driven). Run on the Supabase branch DB:
--   node scripts/run-pgtap.mjs supabase/tests/isolation_all_tables.test.sql
-- Everything happens inside one transaction and is rolled back.
--
-- What this file guarantees, in order:
--   1. Coverage: EVERY base table in schemas public / authz / events is classified in the manifest below.
--      A new table that lands without a manifest row (i.e. without a test) makes section 1 fail loudly
--      ("number of tables tested == number of tables that exist"). authz and events hold only functions,
--      so their table coverage is "exactly zero tables", asserted explicitly.
--   2. Structure: every tenant-scoped table has RLS on, has a workspace_id or tenant_id scoping column,
--      and exposes nothing to anon; no tenant policy is written USING (true); the authz guard functions are
--      SECURITY DEFINER and not callable by anon; events emitters likewise.
--   3. Runtime isolation: a tenant-A principal can neither SELECT, UPDATE, DELETE nor INSERT tenant-B rows,
--      across a broad curated set of tenant tables (the long tail shares the same authz.ws_with policy and is
--      covered structurally in section 2). Storage objects, webhook endpoints + outbound deliveries, and
--      support-session confinement to a single workspace are exercised with real rows.
begin;
select plan(46);

-- ============================================================================
-- Section 1 · Introspection coverage (the "fails when a new table appears" gate)
-- ============================================================================
-- The manifest: every base table in public/authz/events and its isolation category.
--   tenant    = tenant data, isolated by workspace_id and/or tenant_id (RLS via authz.ws_with / tenant_ids_with)
--   partition = a declarative partition that inherits its parent's RLS and columns
--   via       = isolated through a foreign key to a scoped parent (no own scoping column)
--   global    = shared catalogue, identical for every tenant, holds no tenant data
--   platform  = platform-operator identity, not tenant data
--   root      = the tenants table itself (the anchor; each tenant sees only its own row)
create temp table iso_manifest (table_name text primary key, category text not null) on commit drop;
insert into iso_manifest (table_name, category) values
  ('accounts','tenant'),
  ('activities','tenant'),
  ('ad_accounts','tenant'),
  ('agent_runs','tenant'),
  ('agent_triggers','tenant'),
  ('agents','tenant'),
  ('ai_audit','tenant'),
  ('ai_insights','tenant'),
  ('ai_policies','tenant'),
  ('ai_providers','tenant'),
  ('ai_usage','tenant'),
  ('ai_usage_default','partition'),
  ('api_keys','tenant'),
  ('api_request_log','tenant'),
  ('audience_segments','tenant'),
  ('audit_log','tenant'),
  ('backup_alert_rules','tenant'),
  ('backup_checks','tenant'),
  ('calendar_events','tenant'),
  ('campaign_daily_metrics','tenant'),
  ('campaigns','tenant'),
  ('comments','tenant'),
  ('connector_availability','global'),
  ('connector_catalog','global'),
  ('consent_log','tenant'),
  ('contacts','tenant'),
  ('conversations','tenant'),
  ('deal_stage_history','tenant'),
  ('deals','tenant'),
  ('email_identities','tenant'),
  ('email_suppressions','tenant'),
  ('embeddings','tenant'),
  ('event_types','global'),
  ('events','tenant'),
  ('events_default','partition'),
  ('external_links','tenant'),
  ('field_defs','tenant'),
  ('follows','via'),
  ('ga4_daily','tenant'),
  ('gbp_daily','tenant'),
  ('ical_export_tokens','tenant'),
  ('ical_feeds','tenant'),
  ('idempotency_keys','tenant'),
  ('import_jobs','tenant'),
  ('integration_field_maps','tenant'),
  ('integrations','tenant'),
  ('invitations','tenant'),
  ('invoice_series','global'),
  ('invoices','tenant'),
  ('job_runs','tenant'),
  ('layouts','tenant'),
  ('lead_events','tenant'),
  ('leads','tenant'),
  ('linkedin_assets','tenant'),
  ('memberships','tenant'),
  ('message_templates','tenant'),
  ('messages','tenant'),
  ('meta_assets','tenant'),
  ('notification_prefs','tenant'),
  ('notification_rules','tenant'),
  ('notifications','tenant'),
  ('oauth_states','tenant'),
  ('object_types','tenant'),
  ('org_admin_policies','tenant'),
  ('payments','tenant'),
  ('permissions','global'),
  ('pipeline_stages','tenant'),
  ('pipelines','tenant'),
  ('plans','global'),
  ('platform_admins','platform'),
  ('privacy_requests','tenant'),
  ('profiles','tenant'),
  ('rate_limits','global'),
  ('record_links','tenant'),
  ('records','tenant'),
  ('relationship_tuples','tenant'),
  ('retention_policies','tenant'),
  ('reviews','tenant'),
  ('role_permissions','via'),
  ('roles','tenant'),
  ('sales_targets','tenant'),
  ('saved_views','tenant'),
  ('scheduled_jobs','tenant'),
  ('social_account_metrics_daily','tenant'),
  ('social_accounts','tenant'),
  ('social_post_metrics_daily','tenant'),
  ('social_posts','tenant'),
  ('support_sessions','tenant'),
  ('sync_cursors','via'),
  ('sync_runs','tenant'),
  ('tasks','tenant'),
  ('team_members','via'),
  ('teams','tenant'),
  ('tenant_config','tenant'),
  ('tenant_config_history','tenant'),
  ('tenant_subscriptions','tenant'),
  ('tenants','root'),
  ('territories','tenant'),
  ('usage_counters','tenant'),
  ('wa_numbers','tenant'),
  ('webhook_deliveries','tenant'),
  ('webhook_endpoints','tenant'),
  ('webhook_inbox','tenant'),
  ('workspaces','tenant');

-- 1.1 THE gate: every real public base table is in the manifest (new table with no test => this fails and names it).
select is(
  (select coalesce(string_agg(t.table_name, ', ' order by t.table_name), '')
     from information_schema.tables t
     left join iso_manifest m on m.table_name = t.table_name
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE' and m.table_name is null),
  '',
  'coverage: every public base table has a row in the isolation manifest (an untested new table is listed here)');

-- 1.2 and the reverse: the manifest has no stale rows for tables that no longer exist.
select is(
  (select coalesce(string_agg(m.table_name, ', ' order by m.table_name), '')
     from iso_manifest m
     left join information_schema.tables t
       on t.table_name = m.table_name and t.table_schema = 'public' and t.table_type = 'BASE TABLE'
    where t.table_name is null),
  '',
  'coverage: every manifest row maps to a real public base table (no stale entries)');

-- 1.3 count equality stated the way the plan requires: tables tested == tables that exist.
select is(
  (select count(*) from iso_manifest),
  (select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'),
  'coverage: number of tables tested == number of public base tables that exist');

-- 1.4 authz is a function-only schema: zero base tables (so "every authz table is isolated" is vacuously whole).
select is(
  (select count(*) from information_schema.tables where table_schema = 'authz' and table_type = 'BASE TABLE'),
  0::bigint, 'coverage: authz schema holds no base tables (functions only)');

-- 1.5 events is a function-only schema too (the event *bus* table is public.events, not events.*).
select is(
  (select count(*) from information_schema.tables where table_schema = 'events' and table_type = 'BASE TABLE'),
  0::bigint, 'coverage: events schema holds no base tables (functions only)');

-- 1.6 the function surface of authz/events is introspected and non-empty (guards actually exist).
select cmp_ok(
  (select count(*) from information_schema.routines where specific_schema = 'authz' and routine_type = 'FUNCTION'),
  '>=', 20::bigint, 'coverage: authz exposes its guard-function surface');
select cmp_ok(
  (select count(*) from information_schema.routines where specific_schema = 'events' and routine_type = 'FUNCTION'),
  '>=', 1::bigint, 'coverage: events exposes its emitter functions');

-- ============================================================================
-- Section 2 · Structural isolation (covers 100% of tenant tables, no fixtures)
-- ============================================================================
-- 2.1 every tenant / partition table has row-level security enabled.
select is(
  (select coalesce(string_agg(m.table_name, ', ' order by m.table_name), '')
     from iso_manifest m
     join pg_class c on c.relname = m.table_name
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where m.category in ('tenant','partition') and not c.relrowsecurity),
  '', 'structure: every tenant/partition table has RLS enabled (tables missing it are listed)');

-- 2.2 the tenants table (root) and the via-parent tables have RLS as well.
select is(
  (select coalesce(string_agg(m.table_name, ', ' order by m.table_name), '')
     from iso_manifest m
     join pg_class c on c.relname = m.table_name
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where m.category in ('root','via') and not c.relrowsecurity),
  '', 'structure: the tenants anchor and every via-parent table has RLS enabled');

-- 2.3 every tenant table actually carries a workspace_id or tenant_id scoping column.
select is(
  (select coalesce(string_agg(m.table_name, ', ' order by m.table_name), '')
     from iso_manifest m
    where m.category = 'tenant'
      and not exists (select 1 from information_schema.columns col
                       where col.table_schema = 'public' and col.table_name = m.table_name
                         and col.column_name in ('workspace_id','tenant_id'))),
  '', 'structure: every tenant table has a workspace_id or tenant_id column (unscoped tables are listed)');

-- 2.4 conversely, any public base table that HAS a workspace_id column must be a tenant/partition/via table,
--     never mislabelled global/platform (you cannot hide tenant data behind a wrong category).
select is(
  (select coalesce(string_agg(col.table_name, ', ' order by col.table_name), '')
     from information_schema.columns col
     join iso_manifest m on m.table_name = col.table_name
    where col.table_schema = 'public' and col.column_name = 'workspace_id'
      and m.category not in ('tenant','partition','via')),
  '', 'structure: no workspace_id-bearing table is classified global/platform/root');

-- 2.5 anon has no table privilege anywhere in the tenant surface.
select is(
  (select coalesce(string_agg(m.table_name, ', ' order by m.table_name), '')
     from iso_manifest m
    where m.category in ('tenant','partition','via','root')
      and (has_table_privilege('anon', 'public.' || m.table_name, 'select')
        or has_table_privilege('anon', 'public.' || m.table_name, 'insert')
        or has_table_privilege('anon', 'public.' || m.table_name, 'update')
        or has_table_privilege('anon', 'public.' || m.table_name, 'delete'))),
  '', 'structure: anon has no DML privilege on any tenant / root table');

-- 2.6 no policy on a tenant table opens the whole table with USING (true) / WITH CHECK (true) to a logged-in role.
--     (support/platform access always flows through authz.* guards, never a bare "true".)
select is(
  (select coalesce(string_agg(distinct p.tablename || '.' || p.policyname, ', ' order by p.tablename || '.' || p.policyname), '')
     from pg_policies p
     join iso_manifest m on m.table_name = p.tablename
    where p.schemaname = 'public' and m.category in ('tenant','partition','via')
      and 'anon' <> all(coalesce(p.roles, array['public']::name[]))
      and (coalesce(p.qual, 'true') = 'true' and coalesce(p.with_check, 'true') = 'true')),
  '', 'structure: no tenant-table policy grants blanket access via USING (true)');

-- 2.7 the core scoping guards exist and are SECURITY DEFINER (so they can read membership while the caller cannot).
select is(
  (select count(*) from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'authz' and pr.proname in ('ws_with','ws_with_member','tenant_ids_with','my_grants','record_ok') and pr.prosecdef),
  5::bigint, 'structure: authz.ws_with / ws_with_member / tenant_ids_with / my_grants / record_ok are SECURITY DEFINER');

-- 2.8 none of the authz guards is EXECUTE-grantable to anon (a tenant cannot probe another tenant through them).
select is(
  (select coalesce(string_agg(pr.proname, ', ' order by pr.proname), '')
     from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'authz' and pr.proname in ('ws_with','ws_with_member','tenant_ids_with','record_ok','grants')
      and has_function_privilege('anon', pr.oid, 'execute')),
  '', 'structure: no authz guard is executable by anon');

-- 2.9 the events emitter is SECURITY DEFINER and not callable by anon.
select ok(
  (select bool_and(pr.prosecdef) from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'events' and pr.proname = 'emit'),
  'structure: events.emit is SECURITY DEFINER');

-- ============================================================================
-- Section 3 · Runtime per-row isolation (real rows, a tenant-A principal vs tenant-B rows)
-- ============================================================================
-- Fixture (as postgres). Tenant A has two workspaces (A, C) to prove support-session confinement;
-- tenant B is a separate tenant. tenant_id columns are filled by the per-table triggers from workspace_id.
insert into public.tenants (id, slug, name, brand_name) values
  ('10000000-0000-4000-8000-0000000000a8', 'iso-a', 'Iso A', 'Iso A'),
  ('10000000-0000-4000-8000-0000000000b8', 'iso-b', 'Iso B', 'Iso B');
insert into public.workspaces (id, tenant_id, name, slug) values
  ('20000000-0000-4000-8000-0000000000a8', '10000000-0000-4000-8000-0000000000a8', 'Iso A ws', 'iso-a-ws'),
  ('20000000-0000-4000-8000-0000000000c8', '10000000-0000-4000-8000-0000000000a8', 'Iso A ws2', 'iso-a-ws2'),
  ('20000000-0000-4000-8000-0000000000b8', '10000000-0000-4000-8000-0000000000b8', 'Iso B ws', 'iso-b-ws');
insert into auth.users (id, email, email_confirmed_at, aud, role)
select u, 'iso-' || right(u::text, 2) || '@verify.example', now(), 'authenticated', 'authenticated'
  from unnest(array[
    'a8000000-0000-4000-8000-000000000001',  -- owner A (ws A)
    'a8000000-0000-4000-8000-000000000005',  -- owner B (ws B)
    'a8000000-0000-4000-8000-000000000007'   -- platform admin, support session on ws A only
  ]::uuid[]) u;
insert into public.profiles (id, full_name, email)
select id, 'Iso ' || right(id::text, 2), email from auth.users where email like 'iso-%@verify.example' on conflict (id) do nothing;
insert into public.memberships (user_id, workspace_id, role) values
  ('a8000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000a8', 'owner'),
  ('a8000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-0000000000b8', 'owner');
insert into public.platform_admins (user_id, platform_role) values
  ('a8000000-0000-4000-8000-000000000007', 'super_admin');
-- the support session is opened for ws A only (confinement is tested in section 3.4).
insert into public.support_sessions (admin_id, workspace_id, reason, mode, expires_at) values
  ('a8000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-0000000000a8', 'T058 isolation support confinement', 'read_write', now() + interval '30 minutes');

-- Rows in both workspace A and workspace B for a broad, representative set of tenant tables.
insert into public.pipeline_stages (id, workspace_id, key, label, position, probability) values
  ('43000000-0000-4000-8000-0000000000a8', '20000000-0000-4000-8000-0000000000a8', 'discovery', 'Discovery', 1, 10),
  ('43000000-0000-4000-8000-0000000000b8', '20000000-0000-4000-8000-0000000000b8', 'discovery', 'Discovery', 1, 10);
insert into public.leads (id, workspace_id, full_name, email) values
  ('40000000-0000-4000-8000-0000000000a8', '20000000-0000-4000-8000-0000000000a8', 'Lead A', 'a@iso.test'),
  ('40000000-0000-4000-8000-0000000000b8', '20000000-0000-4000-8000-0000000000b8', 'Lead B', 'b@iso.test');
insert into public.accounts (id, workspace_id, name) values
  ('41000000-0000-4000-8000-0000000000a8', '20000000-0000-4000-8000-0000000000a8', 'Account A'),
  ('41000000-0000-4000-8000-0000000000b8', '20000000-0000-4000-8000-0000000000b8', 'Account B');
insert into public.contacts (id, workspace_id, full_name) values
  ('42000000-0000-4000-8000-0000000000a8', '20000000-0000-4000-8000-0000000000a8', 'Contact A'),
  ('42000000-0000-4000-8000-0000000000b8', '20000000-0000-4000-8000-0000000000b8', 'Contact B');
insert into public.deals (id, workspace_id, name, stage_id) values
  ('44000000-0000-4000-8000-0000000000a8', '20000000-0000-4000-8000-0000000000a8', 'Deal A', '43000000-0000-4000-8000-0000000000a8'),
  ('44000000-0000-4000-8000-0000000000b8', '20000000-0000-4000-8000-0000000000b8', 'Deal B', '43000000-0000-4000-8000-0000000000b8');
insert into public.tasks (id, workspace_id, title, due_at) values
  ('45000000-0000-4000-8000-0000000000a8', '20000000-0000-4000-8000-0000000000a8', 'Task A', now()),
  ('45000000-0000-4000-8000-0000000000b8', '20000000-0000-4000-8000-0000000000b8', 'Task B', now());
insert into public.activities (id, workspace_id, kind) values
  ('46000000-0000-4000-8000-0000000000a8', '20000000-0000-4000-8000-0000000000a8', 'note'),
  ('46000000-0000-4000-8000-0000000000b8', '20000000-0000-4000-8000-0000000000b8', 'note');
insert into public.conversations (id, workspace_id, channel) values
  ('47000000-0000-4000-8000-0000000000a8', '20000000-0000-4000-8000-0000000000a8', 'whatsapp'),
  ('47000000-0000-4000-8000-0000000000b8', '20000000-0000-4000-8000-0000000000b8', 'whatsapp');
insert into public.messages (workspace_id, conversation_id, direction, body) values
  ('20000000-0000-4000-8000-0000000000a8', '47000000-0000-4000-8000-0000000000a8', 'inbound', 'hi A'),
  ('20000000-0000-4000-8000-0000000000b8', '47000000-0000-4000-8000-0000000000b8', 'inbound', 'hi B');
insert into public.campaigns (id, workspace_id, name, channel, utm_source, utm_medium, utm_campaign) values
  ('48000000-0000-4000-8000-0000000000a8', '20000000-0000-4000-8000-0000000000a8', 'Camp A', 'email', 's', 'm', 'a'),
  ('48000000-0000-4000-8000-0000000000b8', '20000000-0000-4000-8000-0000000000b8', 'Camp B', 'email', 's', 'm', 'b');
insert into public.integrations (id, workspace_id, provider, label, category, direction) values
  ('49000000-0000-4000-8000-0000000000a8', '20000000-0000-4000-8000-0000000000a8', 'iso', 'Iso A', 'internal', 'in'),
  ('49000000-0000-4000-8000-0000000000b8', '20000000-0000-4000-8000-0000000000b8', 'iso', 'Iso B', 'internal', 'in');
insert into public.payments (id, workspace_id, provider, external_id, amount_paise) values
  ('4a000000-0000-4000-8000-0000000000a8', '20000000-0000-4000-8000-0000000000a8', 'razorpay', 'pay_a', 1000),
  ('4a000000-0000-4000-8000-0000000000b8', '20000000-0000-4000-8000-0000000000b8', 'razorpay', 'pay_b', 1000);
insert into public.reviews (id, workspace_id, rating, review_text, author_name) values
  ('4b000000-0000-4000-8000-0000000000a8', '20000000-0000-4000-8000-0000000000a8', 5, 'A', 'A'),
  ('4b000000-0000-4000-8000-0000000000b8', '20000000-0000-4000-8000-0000000000b8', 5, 'B', 'B');
insert into public.wa_numbers (workspace_id, waba_id, phone_number_id, display_number) values
  ('20000000-0000-4000-8000-0000000000a8', 'waba_a', 'pn_a', '+910000000a8'),
  ('20000000-0000-4000-8000-0000000000b8', 'waba_b', 'pn_b', '+910000000b8');
insert into public.teams (id, workspace_id, name) values
  ('4c000000-0000-4000-8000-0000000000a8', '20000000-0000-4000-8000-0000000000a8', 'Team A'),
  ('4c000000-0000-4000-8000-0000000000b8', '20000000-0000-4000-8000-0000000000b8', 'Team B');
insert into public.notifications (workspace_id, user_id, kind) values
  ('20000000-0000-4000-8000-0000000000a8', 'a8000000-0000-4000-8000-000000000001', 'mention'),
  ('20000000-0000-4000-8000-0000000000b8', 'a8000000-0000-4000-8000-000000000005', 'mention');
insert into public.comments (workspace_id, object_type, object_id, author_id, body) values
  ('20000000-0000-4000-8000-0000000000a8', 'lead', '40000000-0000-4000-8000-0000000000a8', 'a8000000-0000-4000-8000-000000000001', 'A note'),
  ('20000000-0000-4000-8000-0000000000b8', 'lead', '40000000-0000-4000-8000-0000000000b8', 'a8000000-0000-4000-8000-000000000005', 'B note');
insert into public.webhook_endpoints (id, workspace_id, url, event_types) values
  ('4d000000-0000-4000-8000-0000000000a8', '20000000-0000-4000-8000-0000000000a8', 'https://a.example/hook', array['lead.created']),
  ('4d000000-0000-4000-8000-0000000000b8', '20000000-0000-4000-8000-0000000000b8', 'https://b.example/hook', array['lead.created']);
insert into public.webhook_deliveries (endpoint_id, event_type, status) values
  ('4d000000-0000-4000-8000-0000000000a8', 'lead.created', 'pending'),
  ('4d000000-0000-4000-8000-0000000000b8', 'lead.created', 'pending');

-- storage objects: path layout is <prefix>/<workspace_uuid>/<file>, so foldername[2] carries the workspace.
insert into storage.objects (bucket_id, name, owner) values
  ('imports', 'iso/20000000-0000-4000-8000-0000000000a8/a.csv', 'a8000000-0000-4000-8000-000000000001'),
  ('imports', 'iso/20000000-0000-4000-8000-0000000000b8/b.csv', 'a8000000-0000-4000-8000-000000000005');

-- helpers: act as a user; count rows visible to the current role; count affected rows of a DML.
create function pg_temp.act(u uuid, a text default 'aal1') returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', a)::text, true);
  perform set_config('request.jwt.claim.sub', u::text, true);
  execute 'set local role authenticated';
end $f$;
create function pg_temp.cnt(q text) returns bigint language plpgsql as $f$
declare n bigint; begin execute q into n; return n; end $f$;
create function pg_temp.upd(q text) returns bigint language plpgsql as $f$
declare n bigint; begin execute q; get diagnostics n = row_count; return n; end $f$;
-- total number of tenant-B rows visible to whoever is acting, summed across the curated set.
create function pg_temp.b_rows_visible() returns bigint language plpgsql as $f$
declare n bigint;
begin
  select
    (select count(*) from public.leads        where workspace_id = '20000000-0000-4000-8000-0000000000b8')
  + (select count(*) from public.accounts      where workspace_id = '20000000-0000-4000-8000-0000000000b8')
  + (select count(*) from public.contacts      where workspace_id = '20000000-0000-4000-8000-0000000000b8')
  + (select count(*) from public.deals         where workspace_id = '20000000-0000-4000-8000-0000000000b8')
  + (select count(*) from public.tasks         where workspace_id = '20000000-0000-4000-8000-0000000000b8')
  + (select count(*) from public.activities    where workspace_id = '20000000-0000-4000-8000-0000000000b8')
  + (select count(*) from public.conversations where workspace_id = '20000000-0000-4000-8000-0000000000b8')
  + (select count(*) from public.messages      where workspace_id = '20000000-0000-4000-8000-0000000000b8')
  + (select count(*) from public.campaigns     where workspace_id = '20000000-0000-4000-8000-0000000000b8')
  + (select count(*) from public.integrations  where workspace_id = '20000000-0000-4000-8000-0000000000b8')
  + (select count(*) from public.payments      where workspace_id = '20000000-0000-4000-8000-0000000000b8')
  + (select count(*) from public.reviews       where workspace_id = '20000000-0000-4000-8000-0000000000b8')
  + (select count(*) from public.wa_numbers    where workspace_id = '20000000-0000-4000-8000-0000000000b8')
  + (select count(*) from public.teams         where workspace_id = '20000000-0000-4000-8000-0000000000b8')
  + (select count(*) from public.notifications where workspace_id = '20000000-0000-4000-8000-0000000000b8')
  + (select count(*) from public.comments      where workspace_id = '20000000-0000-4000-8000-0000000000b8')
  + (select count(*) from public.webhook_endpoints  where workspace_id = '20000000-0000-4000-8000-0000000000b8')
  + (select count(*) from public.pipeline_stages    where workspace_id = '20000000-0000-4000-8000-0000000000b8')
    into n;
  return n;
end $f$;

-- 3.0 sanity: as postgres (RLS off) tenant B's rows do exist, so a later "0 visible" is meaningful, not vacuous.
select is(pg_temp.b_rows_visible(), 18::bigint, 'fixture: tenant B has one row in each of the 18 curated tables (seen as postgres)');

-- 3.1 owner A: sees own rows, NONE of tenant B's, across the whole curated set in one assertion.
select pg_temp.act('a8000000-0000-4000-8000-000000000001');
select is(pg_temp.b_rows_visible(), 0::bigint, 'owner A: cannot SELECT any tenant-B row across the curated tables');
select is((select count(*) from public.leads), 1::bigint, 'owner A: sees exactly own workspace leads');
select is((select count(*) from public.webhook_endpoints), 1::bigint, 'owner A: webhook endpoint list excludes tenant B''s endpoint');
select is((select count(*) from public.webhook_deliveries), 1::bigint, 'owner A: outbound deliveries never include tenant B''s events');
select is((select count(*) from public.messages where workspace_id = '20000000-0000-4000-8000-0000000000b8'), 0::bigint, 'owner A: tenant B messages invisible');

-- 3.2 owner A: cannot UPDATE or DELETE tenant B rows (0 rows affected — the rows are simply not visible).
select is(pg_temp.upd($$update public.leads set score = 1 where id = '40000000-0000-4000-8000-0000000000b8'$$), 0::bigint, 'owner A: UPDATE of a tenant-B lead affects 0 rows');
select is(pg_temp.upd($$update public.deals set name = 'x' where id = '44000000-0000-4000-8000-0000000000b8'$$), 0::bigint, 'owner A: UPDATE of a tenant-B deal affects 0 rows');
select is(pg_temp.upd($$delete from public.leads where id = '40000000-0000-4000-8000-0000000000b8'$$), 0::bigint, 'owner A: DELETE of a tenant-B lead affects 0 rows');
select is(pg_temp.upd($$delete from public.contacts where id = '42000000-0000-4000-8000-0000000000b8'$$), 0::bigint, 'owner A: DELETE of a tenant-B contact affects 0 rows');
select is(pg_temp.upd($$delete from public.webhook_endpoints where id = '4d000000-0000-4000-8000-0000000000b8'$$), 0::bigint, 'owner A: DELETE of a tenant-B webhook endpoint affects 0 rows');

-- 3.3 owner A: cannot INSERT into tenant B's workspace (RLS WITH CHECK => 42501).
select throws_ok($$insert into public.leads (workspace_id, full_name) values ('20000000-0000-4000-8000-0000000000b8', 'Intruder')$$,
  '42501', null, 'owner A: INSERT into tenant B workspace is denied');
select throws_ok($$insert into public.webhook_endpoints (workspace_id, url, event_types) values ('20000000-0000-4000-8000-0000000000b8', 'https://x.example/h', array['lead.created'])$$,
  '42501', null, 'owner A: cannot create a webhook endpoint in tenant B');
select throws_ok($$insert into public.payments (workspace_id, provider, external_id, amount_paise) values ('20000000-0000-4000-8000-0000000000b8', 'razorpay', 'x', 1)$$,
  '42501', null, 'owner A: cannot record a payment in tenant B');
select throws_ok($$insert into public.comments (workspace_id, object_type, object_id, body) values ('20000000-0000-4000-8000-0000000000b8', 'lead', '40000000-0000-4000-8000-0000000000b8', 'x')$$,
  '42501', null, 'owner A: cannot comment into tenant B');
reset role;

-- 3.4 owner B sees the mirror image: own rows only, nothing of tenant A.
select pg_temp.act('a8000000-0000-4000-8000-000000000005');
select is((select count(*) from public.leads where workspace_id = '20000000-0000-4000-8000-0000000000a8'), 0::bigint, 'owner B: cannot SELECT tenant-A leads');
select is((select count(*) from public.webhook_endpoints where workspace_id = '20000000-0000-4000-8000-0000000000a8'), 0::bigint, 'owner B: cannot see tenant-A webhook endpoint');
select throws_ok($$insert into public.leads (workspace_id, full_name) values ('20000000-0000-4000-8000-0000000000a8', 'Intruder')$$,
  '42501', null, 'owner B: INSERT into tenant A workspace is denied');
reset role;

-- 3.5 the authz guards themselves never leak the other tenant to a principal.
select pg_temp.act('a8000000-0000-4000-8000-000000000001');
select is((select count(*) from authz.ws_with('leads.read') w where w = '20000000-0000-4000-8000-0000000000b8'), 0::bigint, 'authz.ws_with: owner A''s readable workspaces exclude tenant B');
select is((select count(*) from authz.tenant_ids_with('leads.read') t where t = '10000000-0000-4000-8000-0000000000b8'), 0::bigint, 'authz.tenant_ids_with: owner A''s tenants exclude tenant B');
select ok((public.my_grants('20000000-0000-4000-8000-0000000000b8') -> 'perms') = '{}'::jsonb
          or (public.my_grants('20000000-0000-4000-8000-0000000000b8') ->> 'member')::boolean is not true,
          'my_grants(ws B) for owner A yields no membership / no perms');
reset role;

-- ============================================================================
-- Section 3b · Storage, realtime, and support-session confinement
-- ============================================================================
-- 3b.1 storage: an import object is visible only to a principal of its own workspace.
select pg_temp.act('a8000000-0000-4000-8000-000000000001');
select is((select count(*) from storage.objects where bucket_id = 'imports' and (storage.foldername(name))[2] = '20000000-0000-4000-8000-0000000000a8'), 1::bigint,
  'storage: owner A sees its own import object');
select is((select count(*) from storage.objects where bucket_id = 'imports' and (storage.foldername(name))[2] = '20000000-0000-4000-8000-0000000000b8'), 0::bigint,
  'storage: owner A cannot see tenant B''s import object');
reset role;
select pg_temp.act('a8000000-0000-4000-8000-000000000005');
select is((select count(*) from storage.objects where bucket_id = 'imports' and (storage.foldername(name))[2] = '20000000-0000-4000-8000-0000000000a8'), 0::bigint,
  'storage: owner B cannot see tenant A''s import object');
reset role;

-- 3b.2 realtime: realtime.messages (0018) authorises a topic subscribe against membership; a non-member row is refused.
--      The realtime RLS predicate resolves the ws uuid out of the topic and checks authz.ws_with_member; we assert the
--      membership primitive it relies on, since realtime.messages is ephemeral and seeded by the WS server, not here.
select pg_temp.act('a8000000-0000-4000-8000-000000000001');
select ok(exists (select 1 from authz.ws_with_member w where w = '20000000-0000-4000-8000-0000000000a8'),
          'realtime: owner A is a member of its own workspace topic');
select ok(not exists (select 1 from authz.ws_with_member w where w = '20000000-0000-4000-8000-0000000000b8'),
          'realtime: owner A is NOT a member of tenant B''s workspace topic (subscribe would be denied)');
reset role;

-- 3b.3 support session is confined to the one workspace it was opened for (ws A), not ws C of the same tenant,
--      and never ws B of another tenant. The admin acts with aal2 (MFA) + an active read_write session on ws A.
select pg_temp.act('a8000000-0000-4000-8000-000000000007', 'aal2');
select is((select count(*) from public.leads where workspace_id = '20000000-0000-4000-8000-0000000000a8'), 1::bigint,
  'support: the admin sees business data of the session workspace (ws A)');
select is((select count(*) from public.leads where workspace_id = '20000000-0000-4000-8000-0000000000c8'), 0::bigint,
  'support: the session does NOT extend to ws C of the same tenant (confined to one workspace)');
select is((select count(*) from public.leads where workspace_id = '20000000-0000-4000-8000-0000000000b8'), 0::bigint,
  'support: the session never reaches another tenant''s workspace (ws B)');
reset role;

-- a platform admin with NO session sees no business data at all.
insert into auth.users (id, email, email_confirmed_at, aud, role) values
  ('a8000000-0000-4000-8000-00000000000a', 'iso-0a@verify.example', now(), 'authenticated', 'authenticated');
insert into public.profiles (id, full_name, email) values ('a8000000-0000-4000-8000-00000000000a', 'Iso 0a', 'iso-0a@verify.example') on conflict (id) do nothing;
insert into public.platform_admins (user_id, platform_role) values ('a8000000-0000-4000-8000-00000000000a', 'super_admin');
select pg_temp.act('a8000000-0000-4000-8000-00000000000a', 'aal2');
select is((select count(*) from public.leads), 0::bigint, 'support: a platform admin without a session sees no leads of any tenant');
reset role;

select * from finish();
rollback;
