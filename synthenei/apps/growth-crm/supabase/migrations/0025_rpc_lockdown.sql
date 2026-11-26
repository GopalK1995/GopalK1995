-- 0025 RPC lockdown (AUD-056: SEC-003, SEC-004, SEC-005, SEC-016, SEC-023).
--
-- Problems closed:
--   SEC-003  anon (and any member) could call rate_limit_hit() with ANY bucket and poison a victim's login bucket.
--   SEC-004  any member, a viewer included, could forge audit rows (actor_kind, source, ip, any action) through audit_record().
--   SEC-005  any member could add up to 1e9 to the tenant's usage counters through usage_bump().
--   SEC-023  any member could emit any event type (lead.created, payment.captured ...) through emit_event().
--   SEC-016  no server-only path to audit login success/failure.
--
-- What changes:
--   * rate_limit_hit(): EXECUTE only for service_role. New auth_throttle_hit(kind, dimension, value, limit, window) is the
--     narrow login/reset throttle: service_role only, fixed 'auth:' bucket prefix, fixed kinds, value stored only as a sha256 hash
--     (no e-mail address in public.rate_limits), bounded limit and window. The server action calls it with the service client.
--   * usage_bump(): service_role only (no client code calls it).
--   * audit_record(): stays callable by signed-in members (the app audits through the user's client) but now: viewers may only write
--     read-type families, the action must belong to a fixed family allowlist, actor_kind and source are clamped (a client can no longer
--     claim system/connector/job/support/platform_admin; those are derived from the verified state: support session, platform admin).
--   * audit_record_server(): new, service_role only, takes the verified actor from server code (login, MFA, password, connectors).
--   * emit_event(): callers with a user JWT may only emit an allowlist of client-originated types and a bounded payload; service_role
--     (jobs, connectors) is unrestricted, exactly as before.
--
-- Backward compatible: nothing is dropped, existing rows are untouched, function signatures are unchanged.
-- Idempotent: create or replace / revoke / grant can be re-run.
--
-- ROLLBACK (manual, only if the app breaks): re-grant the old privileges and restore the old bodies from 0014 / 0019 / 0020:
--   grant execute on function public.rate_limit_hit(text, int, int) to anon, authenticated;
--   grant execute on function public.usage_bump(text, bigint, uuid) to authenticated;
--   (audit_record / emit_event: re-run their definitions from 0019 / 0014);
--   drop function public.auth_throttle_hit(text, text, text, int, int);
--   drop function public.audit_record_server(uuid, uuid, text, text, text, text, jsonb, text, text, text, text, text);

-- ---------- 1. rate limiting ----------
revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;

create or replace function public.auth_throttle_hit(p_kind text, p_dim text, p_value text, p_limit int, p_window_s int)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_bucket text;
begin
  if p_kind is null or p_kind not in ('login', 'reset') or p_dim is null or p_dim not in ('email', 'ip')
     or p_value is null or length(btrim(p_value)) not between 1 and 320
     or p_limit is null or p_limit not between 1 and 1000 or p_window_s is null or p_window_s not between 60 and 86400 then
    raise exception 'invalid throttle arguments' using errcode = '22023';
  end if;
  -- fixed prefix + hashed key: a caller cannot address a bucket outside the auth: namespace, and no address is stored in clear
  v_bucket := 'auth:' || p_kind || ':' || p_dim || ':' || encode(sha256(convert_to(lower(btrim(p_value)), 'utf8')), 'hex');
  return public.rate_limit_hit(v_bucket, p_limit, p_window_s);
end $$;
revoke all on function public.auth_throttle_hit(text, text, text, int, int) from public, anon, authenticated;
grant execute on function public.auth_throttle_hit(text, text, text, int, int) to service_role;

-- ---------- 2. usage counters ----------
revoke all on function public.usage_bump(text, bigint, uuid) from public, anon, authenticated;
grant execute on function public.usage_bump(text, bigint, uuid) to service_role;

-- ---------- 3. audit_record: caller checks, family allowlist, clamped actor ----------
create or replace function public.audit_record(p_workspace uuid, p_action text, p_summary text, p_object_table text, p_object_id text,
  p_reason text, p_detail jsonb, p_source text, p_actor_kind text, p_request_id text, p_ip text, p_user_agent text, p_impersonation boolean)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_tenant uuid; v_ss uuid; v_label text; v_kind text; v_src text; v_ip inet; v_id bigint;
  v_changes jsonb; v_family text; v_role public.app_role;
  v_fam_member text[] := array['leads','deals','contacts','accounts','campaigns','segments','export','import','csv_import','records','layouts',
    'objects','fields','config','pipelines','connector','email','mailchimp','webhook','privacy','audit','billing','backup','member','role',
    'apikey','google','gcal','gmail','ga4','google_ads','google_business','google_sheets','hubspot','ical','linkedin','meta','outlook','slack',
    'crm_sync','zoho','razorpay','whatsapp','calendly','integration'];
  v_fam_viewer text[] := array['leads','export','audit'];
  v_fam_admin text[] := array['platform_admin','tenant','workspace','member','support','backup','billing','audit'];
begin
  if v_uid is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_action is null or p_action !~ '^[a-z][a-z0-9_.:-]{0,63}$' then
    raise exception 'invalid audit action' using errcode = '22023'; end if;
  v_family := split_part(p_action, '.', 1);
  if p_workspace is null then
    if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
    if v_family <> all(v_fam_admin) then raise exception 'audit action not permitted' using errcode = '42501'; end if;
  else
    if p_workspace not in (select public.member_ws_ids()) then raise exception 'not allowed' using errcode = '42501'; end if;
    select w.tenant_id into v_tenant from public.workspaces w where w.id = p_workspace;
    select s.id into v_ss from public.support_sessions s
     where s.admin_id = v_uid and s.workspace_id = p_workspace and s.ended_at is null and now() < s.expires_at
     order by s.started_at desc limit 1;
    v_role := public.ws_role(p_workspace);
    if v_family = 'support' then
      if v_ss is null then raise exception 'audit action not permitted' using errcode = '42501'; end if;
    elsif v_family <> all(v_fam_member) then
      raise exception 'audit action not permitted' using errcode = '42501';
    elsif v_role = 'viewer' and v_family <> all(v_fam_viewer) then
      raise exception 'audit action not permitted' using errcode = '42501';
    end if;
  end if;
  v_label := case when v_ss is not null then 'support' when p_workspace is null then 'platform_admin' else 'user' end;
  -- the label is derived from verified state; a client can only choose between the low-privilege kinds
  v_kind := case when v_ss is not null then 'support' when p_workspace is null then 'platform_admin'
                 when p_actor_kind in ('api_key', 'agent') then p_actor_kind else 'user' end;
  v_src := case when v_ss is not null then 'support' when p_source in ('api', 'agent') then p_source else 'ui' end;
  begin v_ip := nullif(p_ip, '')::inet; exception when others then v_ip := null; end;
  v_changes := case when p_detail is null or jsonb_typeof(p_detail) <> 'object' then '{}'::jsonb else p_detail end;
  if pg_column_size(v_changes) > 8000 then v_changes := jsonb_build_object('truncated', true); end if;
  if coalesce(p_impersonation, false) and v_ss is not null then v_changes := v_changes || '{"impersonation": true}'::jsonb; end if;
  insert into public.audit_log (tenant_id, workspace_id, actor_id, actor_label, action, table_name, row_id, changes,
                                support_session_id, actor_kind, source, request_id, ip, user_agent, reason, summary)
  values (v_tenant, p_workspace, v_uid, v_label, p_action, coalesce(nullif(left(p_object_table, 63), ''), 'app'), left(p_object_id, 200),
          nullif(v_changes, '{}'::jsonb), v_ss, v_kind, v_src, left(p_request_id, 200), v_ip, left(p_user_agent, 300),
          left(nullif(trim(p_reason), ''), 500), left(p_summary, 300))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.audit_record(uuid, text, text, text, text, text, jsonb, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.audit_record(uuid, text, text, text, text, text, jsonb, text, text, text, text, text, boolean) to authenticated, service_role;

-- ---------- 4. audit_record_server: the verified, server-only path (login, MFA, password, connectors) ----------
create or replace function public.audit_record_server(p_actor uuid, p_workspace uuid, p_action text, p_summary text, p_object_table text,
  p_object_id text, p_detail jsonb, p_source text, p_actor_kind text, p_request_id text, p_ip text, p_user_agent text)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare v_tenant uuid; v_kind text; v_src text; v_ip inet; v_changes jsonb; v_id bigint;
begin
  if p_action is null or p_action !~ '^[a-z][a-z0-9_.:-]{0,63}$' then raise exception 'invalid audit action' using errcode = '22023'; end if;
  if p_workspace is not null then
    select w.tenant_id into v_tenant from public.workspaces w where w.id = p_workspace;
    if v_tenant is null then raise exception 'unknown workspace' using errcode = '22023'; end if;
  end if;
  v_kind := case when p_actor_kind in ('user', 'api_key', 'system', 'connector', 'agent') then p_actor_kind
                 when p_actor is null then 'system' else 'user' end;
  v_src := case when p_source in ('ui', 'api', 'connector', 'job', 'agent') then p_source else 'ui' end;
  begin v_ip := nullif(p_ip, '')::inet; exception when others then v_ip := null; end;
  v_changes := case when p_detail is null or jsonb_typeof(p_detail) <> 'object' then '{}'::jsonb else p_detail end;
  if pg_column_size(v_changes) > 8000 then v_changes := jsonb_build_object('truncated', true); end if;
  insert into public.audit_log (tenant_id, workspace_id, actor_id, actor_label, action, table_name, row_id, changes,
                                actor_kind, source, request_id, ip, user_agent, summary)
  values (v_tenant, p_workspace, p_actor, 'server', p_action, coalesce(nullif(left(p_object_table, 63), ''), 'app'), left(p_object_id, 200),
          nullif(v_changes, '{}'::jsonb), v_kind, v_src, left(p_request_id, 200), v_ip, left(p_user_agent, 300), left(p_summary, 300))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.audit_record_server(uuid, uuid, text, text, text, text, jsonb, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.audit_record_server(uuid, uuid, text, text, text, text, jsonb, text, text, text, text, text) to service_role;

-- ---------- 5. emit_event: user JWT callers get an allowlist ----------
create or replace function public.emit_event(p_type text, p_object_type text, p_object_id uuid, p_data jsonb default '{}')
returns bigint language plpgsql volatile security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null then
    -- types a signed-in client legitimately raises itself; everything else (row events, payments, webhooks, connector facts) is server-side
    if p_type is null or not (p_type in ('metadata.changed', 'lead.exported', 'audience.exported', 'comment.created', 'mention.created', 'consent.changed')
                              or p_type ~ '^record\.[a-z][a-z0-9_]{0,40}\.(created|updated|deleted)$') then
      raise exception 'event type not permitted' using errcode = '42501';
    end if;
    if p_data is not null and pg_column_size(p_data) > 8000 then
      raise exception 'event data too large' using errcode = '22023';
    end if;
  end if;
  return events.emit(p_type, p_object_type, p_object_id, p_data);
end $$;
revoke all on function public.emit_event(text, text, uuid, jsonb) from public, anon;
grant execute on function public.emit_event(text, text, uuid, jsonb) to authenticated, service_role;
