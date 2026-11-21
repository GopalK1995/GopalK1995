-- pgTAP for 0021d_social_metrics (T071). Run on the Supabase branch DB: node scripts/run-pgtap.mjs supabase/tests/0021d_social_metrics.test.sql
-- Everything happens inside one transaction and is rolled back.
begin;
select plan(18);

-- ---------- fixture (as postgres) ----------
insert into public.tenants (id, slug, name, brand_name) values
  ('10000000-0000-4000-8000-0000000000e1', 'tap21b-a', 'Tap21b A', 'Tap21b A'),
  ('10000000-0000-4000-8000-0000000000e2', 'tap21b-b', 'Tap21b B', 'Tap21b B');
insert into public.workspaces (id, tenant_id, name, slug) values
  ('20000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', 'Tap21b A ws', 'tap21b-a-ws'),
  ('20000000-0000-4000-8000-0000000000e2', '10000000-0000-4000-8000-0000000000e2', 'Tap21b B ws', 'tap21b-b-ws');
insert into auth.users (id, email, email_confirmed_at, aud, role)
select u, 'tap21b-' || right(u::text, 2) || '@verify.example', now(), 'authenticated', 'authenticated'
  from unnest(array[
    'e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000003']::uuid[]) u;
insert into public.profiles (id, full_name, email)
select id, 'Tap21b ' || right(id::text, 2), email from auth.users where email like 'tap21b-%@verify.example' on conflict (id) do nothing;
-- 01 owner A, 02 sales rep A (no analytics.read), 03 owner B
insert into public.memberships (user_id, workspace_id, role) values
  ('e1000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000e1', 'owner'),
  ('e1000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000e1', 'sales_rep'),
  ('e1000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-0000000000e2', 'owner');

create function pg_temp.act(u uuid, a text default 'aal1') returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', a)::text, true);
  perform set_config('request.jwt.claim.sub', u::text, true);
  execute 'set local role authenticated';
end $f$;
create function pg_temp.cnt(q text) returns bigint language plpgsql as $f$
declare n bigint; begin execute q into n; return n; end $f$;

-- rows as the sync job writes them (postgres bypasses RLS like the service role)
insert into public.social_accounts (id, workspace_id, platform, external_id, display_name, followers) values
  ('b1000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000e1', 'instagram', 'ig-a', 'A on Instagram', 1200),
  ('b1000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000e2', 'facebook', 'fb-b', 'B on Facebook', 300);
insert into public.social_posts (id, workspace_id, account_id, external_id, kind, posted_at) values
  ('b2000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000e1', 'b1000000-0000-4000-8000-000000000001', 'p1', 'reel', now() - interval '2 days'),
  ('b2000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000e2', 'b1000000-0000-4000-8000-000000000002', 'p2', 'feed', now() - interval '2 days');
insert into public.social_post_metrics_daily (workspace_id, post_id, day, impressions, reach, likes, comments, shares, saves) values
  ('20000000-0000-4000-8000-0000000000e1', 'b2000000-0000-4000-8000-000000000001', current_date - 1, 500, 400, 30, 6, 4, 10),
  ('20000000-0000-4000-8000-0000000000e1', 'b2000000-0000-4000-8000-000000000001', current_date,     null, null, null, null, null, null),
  ('20000000-0000-4000-8000-0000000000e2', 'b2000000-0000-4000-8000-000000000002', current_date - 1, 90, 80, 5, 0, 0, 0);
insert into public.social_account_metrics_daily (workspace_id, account_id, day, followers, follower_delta, profile_views) values
  ('20000000-0000-4000-8000-0000000000e1', 'b1000000-0000-4000-8000-000000000001', current_date - 1, 1200, 12, 40),
  ('20000000-0000-4000-8000-0000000000e2', 'b1000000-0000-4000-8000-000000000002', current_date - 1, 300, -1, 9);

-- ---------- structure ----------
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname in ('social_accounts','social_posts','social_post_metrics_daily','social_account_metrics_daily') and c.relrowsecurity),
          4::bigint, 'RLS enabled on all four social tables');
select is((select count(*) from information_schema.columns where table_schema = 'public'
            and table_name in ('social_accounts','social_posts','social_post_metrics_daily','social_account_metrics_daily') and column_name in ('tenant_id','workspace_id')), 8::bigint, 'every table carries tenant_id and workspace_id');
select is((select tenant_id from public.social_posts where id = 'b2000000-0000-4000-8000-000000000001'), '10000000-0000-4000-8000-0000000000e1'::uuid, 'tenant_id follows the workspace');

-- ---------- metric semantics ----------
select is((select engagement_rate from public.social_post_metrics_daily where post_id = 'b2000000-0000-4000-8000-000000000001' and day = current_date - 1), 0.125::numeric, 'engagement rate = interactions / reach');
select is((select engagement_rate from public.social_post_metrics_daily where post_id = 'b2000000-0000-4000-8000-000000000001' and day = current_date), null::numeric, 'unknown reach gives a null engagement rate, not 0');
select is((select reach from public.social_post_metrics_daily where post_id = 'b2000000-0000-4000-8000-000000000001' and day = current_date), null::integer, 'an unreported metric stays null');
select throws_ok($$insert into public.social_post_metrics_daily (workspace_id, post_id, day, reach) values
  ('20000000-0000-4000-8000-0000000000e1', 'b2000000-0000-4000-8000-000000000001', current_date - 1, 1)$$, '23505', null, 'one metrics row per post and day');
select throws_ok($insert into public.social_posts (workspace_id, account_id, external_id, kind, posted_at, status) values
  ('20000000-0000-4000-8000-0000000000e1', 'b1000000-0000-4000-8000-000000000001', 'p8', 'feed', now(), 'removed')$, '23514', null, 'post status is constrained');
select throws_ok($$insert into public.social_posts (workspace_id, account_id, external_id, kind, posted_at) values
  ('20000000-0000-4000-8000-0000000000e1', 'b1000000-0000-4000-8000-000000000001', 'p9', 'podcast', now())$$, '23514', null, 'post kind is constrained');
select throws_ok($$insert into public.social_posts (workspace_id, account_id, external_id, kind, posted_at) values
  ('20000000-0000-4000-8000-0000000000e1', 'b1000000-0000-4000-8000-000000000001', 'p1', 'feed', now())$$, '23505', null, 'a post is deduped on account and external id');

-- ---------- isolation and read rights ----------
select pg_temp.act('e1000000-0000-4000-8000-000000000001');
select is(pg_temp.cnt($$select count(*) from public.social_accounts$$), 1::bigint, 'owner A sees only workspace A accounts');
select is(pg_temp.cnt($$select count(*) from public.social_posts$$), 1::bigint, 'owner A sees only workspace A posts');
select is(pg_temp.cnt($$select count(*) from public.social_post_metrics_daily$$), 2::bigint, 'owner A sees only workspace A post metrics');
select is(pg_temp.cnt($$select count(*) from public.social_account_metrics_daily$$), 1::bigint, 'owner A sees only workspace A account metrics');
select throws_ok($$insert into public.social_posts (workspace_id, account_id, external_id, kind, posted_at) values
  ('20000000-0000-4000-8000-0000000000e1', 'b1000000-0000-4000-8000-000000000001', 'px', 'feed', now())$$, '42501', null, 'an owner cannot write a post from the client');
select throws_ok($$update public.social_post_metrics_daily set likes = 999$$, '42501', null, 'an owner cannot edit metrics from the client');
reset role;
select pg_temp.act('e1000000-0000-4000-8000-000000000003');
select is(pg_temp.cnt($$select count(*) from (select 1 from public.social_accounts union all select 1 from public.social_posts
  union all select 1 from public.social_post_metrics_daily union all select 1 from public.social_account_metrics_daily) x where true$$),
  4::bigint, 'owner B sees only workspace B rows');
reset role;
select pg_temp.act('e1000000-0000-4000-8000-000000000002');
select is(pg_temp.cnt($$select count(*) from (select 1 from public.social_accounts union all select 1 from public.social_posts
  union all select 1 from public.social_post_metrics_daily union all select 1 from public.social_account_metrics_daily) x$$),
  0::bigint, 'a sales rep (no analytics.read) sees no social rows');
reset role;

select * from finish();
rollback;
