-- Isolation checks for the workspace model. Safe to run on the live project: everything happens inside one
-- DO block that ends with RAISE EXCEPTION, so the temporary test identities (auth.users rows without passwords,
-- memberships, a platform admin, support sessions) are rolled back. The result table is returned in the error text.
-- Requires seed.sql to be loaded (demo workspace ids below).
do $$
declare
  tn  constant uuid := '20000000-0000-4000-8000-000000000001';
  kl  constant uuid := '20000000-0000-4000-8000-000000000002';
  kv  constant uuid := '20000000-0000-4000-8000-000000000003';
  u_owner constant uuid := 'a0000000-0000-4000-8000-00000000000a';  -- owner TN, viewer KL
  u_rep   constant uuid := 'b0000000-0000-4000-8000-00000000000b';  -- sales_rep TN
  u_kav   constant uuid := 'c0000000-0000-4000-8000-00000000000c';  -- owner Kaveri
  u_adm   constant uuid := 'd0000000-0000-4000-8000-00000000000d';  -- platform admin
  res text := '';
  n bigint; m bigint; ok_n bigint; ok boolean; err text;
begin
  insert into auth.users (id, email, email_confirmed_at, aud, role) values
    (u_owner, 'qa-owner@verify.example', now(), 'authenticated', 'authenticated'),
    (u_rep,   'qa-rep@verify.example',   now(), 'authenticated', 'authenticated'),
    (u_kav,   'qa-kaveri@verify.example',now(), 'authenticated', 'authenticated'),
    (u_adm,   'qa-admin@verify.example', now(), 'authenticated', 'authenticated');
  insert into public.profiles (id, full_name, email) values
    (u_owner,'QA Owner','qa-owner@verify.example'), (u_rep,'QA Rep','qa-rep@verify.example'),
    (u_kav,'QA Kaveri','qa-kaveri@verify.example'), (u_adm,'QA Admin','qa-admin@verify.example')
  on conflict (id) do nothing;
  insert into public.memberships (user_id, workspace_id, role) values
    (u_owner, tn, 'owner'), (u_owner, kl, 'viewer'), (u_rep, tn, 'sales_rep'), (u_kav, kv, 'owner');
  insert into public.platform_admins (user_id) values (u_adm);
  update public.leads set owner_id = u_rep where workspace_id = tn and district = 'Madurai';

  -- anon
  execute 'set local role anon';
  begin perform count(*) from public.leads; res := res || E'\nanon select leads: ALLOWED (FAIL)';
  exception when insufficient_privilege then res := res || E'\nanon select leads: permission denied (PASS)'; end;
  begin perform count(*) from public.v_leads_masked; res := res || E'\nanon select v_leads_masked: ALLOWED (FAIL)';
  exception when insufficient_privilege then res := res || E'\nanon select v_leads_masked: permission denied (PASS)'; end;
  begin perform public.submit_lead('lawsome-tn','QA Person','qa-nocons@verify.example',null,'QA','Other',null,null,null,false);
        res := res || E'\nanon submit_lead without consent: ACCEPTED (FAIL)';
  exception when others then res := res || E'\nanon submit_lead without consent: rejected "' || sqlerrm || '" (PASS)'; end;
  execute 'reset role';

  -- owner of TN (viewer in KL)
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.leads where workspace_id = tn;
  res := res || format(E'\nowner TN: leads in TN = %s (expect all)', n);
  select count(*) into n from public.leads where workspace_id = kl;
  select count(*) into m from public.v_leads_masked where workspace_id = kl;
  res := res || format(E'\nsame user as viewer in KL: raw leads = %s (expect 0), masked rows = %s (expect >0)', n, m);
  select count(*) into n from public.leads where workspace_id = kv;
  res := res || format(E'\nowner TN: Kaveri leads = %s (expect 0)', n);
  update public.tenants set brand_primary = '#000000' where slug = 'kaveri-demo';
  get diagnostics n = row_count;
  res := res || format(E'\nowner TN rebrands Kaveri tenant: rows updated = %s (expect 0)', n);
  execute 'reset role';

  -- sales rep
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', u_rep::text, true);
  execute 'set local role authenticated';
  select count(*), count(*) filter (where owner_id is distinct from u_rep) into n, m from public.leads;
  res := res || format(E'\nsales_rep TN: visible leads = %s, not own = %s (expect 0)', n, m);
  select count(*) into n from public.v_funnel_daily;
  res := res || format(E'\nsales_rep TN: team funnel rows = %s (expect 0)', n);
  begin update public.memberships set role = 'owner' where user_id = u_rep; get diagnostics n = row_count;
        res := res || format(E'\nsales_rep self-promotes: rows updated = %s (expect 0)', n);
  exception when others then res := res || E'\nsales_rep self-promotes: blocked (PASS)'; end;
  execute 'reset role';

  -- Kaveri owner
  perform set_config('request.jwt.claims', json_build_object('sub', u_kav, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', u_kav::text, true);
  execute 'set local role authenticated';
  select count(*), count(distinct workspace_id) into n, m from public.leads;
  res := res || format(E'\nKaveri owner: leads = %s across %s workspace(s) (expect 1)', n, m);
  execute 'reset role';

  -- platform admin
  perform set_config('request.jwt.claim.sub', u_adm::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  select public.is_platform_admin(), (select count(*) from public.leads) into ok, n;
  res := res || format(E'\nplatform admin at aal1: is_platform_admin = %s, leads = %s (expect f, 0)', ok, n);
  perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select public.is_platform_admin(), (select count(*) from public.leads), (select count(*) from public.tenants) into ok, n, m;
  res := res || format(E'\nplatform admin aal2, no session: is_platform_admin = %s, leads = %s (expect 0), tenants = %s', ok, n, m);
  perform public.start_support_session(tn, 'QA verification of workspace isolation', 'read_only', 15);
  select (select count(*) from public.leads), (select count(*) from public.v_leads_masked) into n, m;
  res := res || format(E'\nread_only support session: raw leads = %s (expect 0), masked = %s', n, m);
  perform public.start_support_session(tn, 'QA verification of workspace isolation', 'read_write', 15);
  select (select count(*) from public.leads where workspace_id = tn), (select count(*) from public.leads where workspace_id <> tn) into n, m;
  res := res || format(E'\nread_write support session: TN leads = %s, other workspaces = %s (expect 0)', n, m);
  begin perform public.erase_lead((select id from public.leads where workspace_id = tn limit 1));
        res := res || E'\nerase_lead during support session: ALLOWED (FAIL)';
  exception when others then res := res || E'\nerase_lead during support session: refused (PASS)'; end;
  perform public.end_support_session(null, tn);
  select count(*) into n from public.leads;
  res := res || format(E'\nafter end_support_session: leads = %s (expect 0)', n);
  execute 'reset role';
  begin insert into public.memberships (user_id, workspace_id, role) values (u_adm, kv, 'viewer');
        res := res || E'\nplatform admin given a membership: ALLOWED (FAIL)';
  exception when others then res := res || E'\nplatform admin given a membership: refused (PASS)'; end;

  -- 0016-0018 tables (v2 policies, metadata, collaboration)
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  select (select count(*) from public.pipelines where workspace_id = tn), (select count(*) from public.pipelines where workspace_id <> tn and workspace_id <> kl) into n, m;
  res := res || format(E'
owner TN: pipelines in TN = %s (expect >0), in other workspaces = %s (expect 0)', n, m);
  select count(*) into n from public.object_types where tenant_id <> (select tenant_id from public.workspaces where id = tn)
     and tenant_id not in (select tenant_id from public.workspaces where id = kl);
  res := res || format(E'
owner TN: object types of other tenants = %s (expect 0)', n);
  select (select count(*) from public.comments), (select count(*) from public.notifications), (select count(*) from public.records) into n, m, ok_n;
  res := res || format(E'
owner TN: comments/notifications/records visible = %s/%s/%s (expect 0/0/0 on a fresh seed)', n, m, ok_n);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', u_kav::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_kav, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.pipelines where workspace_id <> kv;
  res := res || format(E'
Kaveri owner: pipelines outside own workspace = %s (expect 0)', n);
  select count(*) into n from public.field_defs f where f.tenant_id <> (select tenant_id from public.workspaces where id = kv);
  res := res || format(E'
Kaveri owner: field definitions of other tenants = %s (expect 0)', n);
  begin insert into public.comments (workspace_id, object_type, object_id, body) values (tn, 'lead', (select id from public.leads limit 1), 'x');
        res := res || E'
Kaveri owner comments in TN: ALLOWED (FAIL)';
  exception when others then res := res || E'
Kaveri owner comments in TN: refused (PASS)'; end;
  execute 'reset role';

  raise exception 'VERIFY RESULTS (rolled back):%', res;
end $$;
