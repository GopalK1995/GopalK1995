-- 0026 events / audit privacy (AUD-032: BE-024, PRIV-048, BE-048, PRIV-009).
--
--   BE-024   events.row_change() hid personal data with a DENYLIST (full_name, email, ...), so tasks.title ("First response: <lead name>"),
--            leads.custom, deals.name, contacts.role_title ... travelled in event payloads to webhook deliveries and the events table.
--            Now an ALLOWLIST of columns per object: ids, enums, flags, numbers and timestamps only. Free text and jsonb never travel.
--   PRIV-048 audit_row_change() stored every changed value except 8 named PII columns. Now it stores a value only when the column is
--            structural (ids, enums, flags, timestamps, numbers); every other column is recorded by NAME with the value "[redacted]".
--   BE-048   consent_log was append-only only against the authenticated role (service_role had UPDATE, DELETE, TRUNCATE).
--            Now: privileges revoked and a trigger refuses UPDATE / DELETE / TRUNCATE (FK cascades such as ON DELETE SET NULL still work).
--   PRIV-009 consent_log.subject_ref was an unsalted sha256 of an e-mail / phone (enumerable offline). New rows are re-keyed with an HMAC
--            using a server-side secret from Vault ('consent_subject_salt') and carry the marker 'h1:'. Existing rows are NOT rotated.
--            Until the owner creates the Vault secret the trigger does nothing (fully backward compatible).
--
-- OWNER STEP (once, after applying; not part of this file because it holds a secret):
--   select vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'consent_subject_salt', 'HMAC key for consent_log.subject_ref');
--   Keep a copy of the value in the password manager: losing it makes salted subject_refs unmatchable.
--
-- Lookups by subject must use public.consent_log_for_subject(workspace, ref) which matches both the legacy and the salted form.
--
-- Idempotent. ROLLBACK (manual): drop trigger a05_consent_subject_salt / consent_log_append_only* on public.consent_log;
--   grant update, delete, truncate on public.consent_log to service_role; drop function public.consent_log_for_subject(uuid, text);
--   restore events.row_change() and public.audit_row_change() from 0014 / 0022b. Rows already salted keep their 'h1:' value.

-- ---------- 1. events.row_change: column allowlist per object ----------
create or replace function events.row_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r jsonb := coalesce(r_new, r_old);
  v_obj text := case tg_table_name
    when 'leads' then 'lead' when 'deals' then 'deal' when 'accounts' then 'account' when 'contacts' then 'contact'
    when 'tasks' then 'task' when 'activities' then 'activity' when 'conversations' then 'conversation'
    when 'messages' then 'message' when 'campaigns' then 'campaign' when 'memberships' then 'member' end;
  v_ws uuid := (r->>'workspace_id')::uuid;
  v_tenant uuid := (r->>'tenant_id')::uuid;
  v_oid uuid := nullif(r->>'id', '')::uuid;
  v_changed text[]; v_data jsonb; v_verb text;
  -- only these columns ever travel in an event; anything else (names, titles, subjects, bodies, custom, external ids) is dropped.
  -- Consumers refetch the record under their own principal. New columns are private until added here on purpose.
  v_allow text[] := array['id', 'tenant_id', 'workspace_id', 'created_at', 'updated_at', 'deleted_at', 'version'] || case tg_table_name
    when 'leads' then array['status', 'source', 'owner_id', 'assigned_at', 'campaign_id', 'account_id', 'contact_id', 'pipeline_id', 'stage_id', 'score',
      'first_touch_channel', 'last_touch_channel', 'first_response_at', 'last_touch_at', 'next_step_at', 'consent_demo_followup',
      'consent_whatsapp', 'consent_marketing', 'personal_email', 'is_synthetic']
    when 'deals' then array['account_id', 'primary_contact_id', 'lead_id', 'pipeline_id', 'stage_id', 'stage_entered_at', 'value_inr', 'seats', 'plan',
      'expected_close_on', 'owner_id', 'next_step_at', 'won_at', 'lost_at']
    when 'accounts' then array['customer_status', 'owner_id', 'size_band', 'is_synthetic']
    when 'contacts' then array['account_id', 'owner_id', 'is_decision_maker', 'preferred_language']
    when 'tasks' then array['lead_id', 'deal_id', 'kind', 'priority', 'assignee_id', 'created_by', 'due_at', 'status', 'completed_at']
    when 'activities' then array['kind', 'lead_id', 'contact_id', 'account_id', 'deal_id', 'owner_id', 'direction', 'scheduled_at', 'done_at',
      'source', 'meeting_type', 'duration_mins']
    when 'conversations' then array['channel', 'lead_id', 'contact_id', 'assignee_id', 'status', 'last_inbound_at', 'last_message_at']
    when 'messages' then array['conversation_id', 'direction', 'status', 'template_id', 'is_internal_note', 'sent_by', 'status_at']
    when 'campaigns' then array['channel', 'status', 'segment_id', 'starts_on', 'ends_on', 'budget_inr', 'owner_id', 'utm_source', 'utm_medium', 'utm_campaign']
    when 'memberships' then array['user_id', 'role', 'role_id', 'is_active', 'invited_by', 'valid_until']
    else array[]::text[] end;
  v_before jsonb; v_after jsonb;
begin
  if v_obj is null or v_ws is null then return coalesce(new, old); end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.workspaces w where w.id = v_ws) then
    return old;   -- workspace/tenant purge cascade: nothing left to attach the event to
  end if;
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_changed
      from jsonb_each(r_new) n join jsonb_each(r_old) o using (key)
     where n.value is distinct from o.value and n.key not in ('updated_at', 'version');
    if v_changed is null then return new; end if;
    select jsonb_object_agg(key, value) into v_before from jsonb_each(r_old) where key = any(v_changed) and key = any(v_allow);
    select jsonb_object_agg(key, value) into v_after from jsonb_each(r_new) where key = any(v_changed) and key = any(v_allow);
    v_verb := case when r_old->>'deleted_at' is null and r_new->>'deleted_at' is not null then 'deleted' else 'updated' end;
  elsif tg_op = 'INSERT' then
    v_changed := null;
    select jsonb_object_agg(key, value) into v_after from jsonb_each(r_new) where key = any(v_allow);
    v_verb := 'created';
  else
    select jsonb_object_agg(key, value) into v_before from jsonb_each(r_old) where key = any(v_allow);
    v_verb := 'deleted';
  end if;
  v_data := jsonb_strip_nulls(jsonb_build_object('changed_fields', to_jsonb(v_changed), 'before', v_before, 'after', v_after));
  if pg_column_size(v_data) > 6000 then v_data := jsonb_build_object('changed_fields', to_jsonb(v_changed), 'truncated', true); end if;

  perform events._insert(v_tenant, v_ws, v_obj || '.' || v_verb, v_obj, v_oid, v_data);

  -- derived events
  if tg_op = 'UPDATE' then
    if tg_table_name = 'leads' then
      if r_new->>'owner_id' is distinct from r_old->>'owner_id' then
        perform events._insert(v_tenant, v_ws, 'lead.assigned', v_obj, v_oid,
          jsonb_build_object('before', jsonb_build_object('owner_id', r_old->'owner_id'), 'after', jsonb_build_object('owner_id', r_new->'owner_id')));
      end if;
      if r_new->>'status' is distinct from r_old->>'status' then
        perform events._insert(v_tenant, v_ws, 'lead.stage_changed', v_obj, v_oid,
          jsonb_build_object('before', jsonb_build_object('status', r_old->'status'), 'after', jsonb_build_object('status', r_new->'status')));
      end if;
    elsif tg_table_name = 'deals' then
      if r_new->>'stage_id' is distinct from r_old->>'stage_id' then
        perform events._insert(v_tenant, v_ws, 'deal.stage_changed', v_obj, v_oid,
          jsonb_build_object('before', jsonb_build_object('stage_id', r_old->'stage_id'), 'after', jsonb_build_object('stage_id', r_new->'stage_id')));
      end if;
      if r_old->>'won_at' is null and r_new->>'won_at' is not null then
        perform events._insert(v_tenant, v_ws, 'deal.won', v_obj, v_oid, jsonb_build_object('after', jsonb_build_object('won_at', r_new->'won_at')));
      end if;
      if r_old->>'lost_at' is null and r_new->>'lost_at' is not null then
        perform events._insert(v_tenant, v_ws, 'deal.lost', v_obj, v_oid, jsonb_build_object('after', jsonb_build_object('lost_at', r_new->'lost_at')));
      end if;
    elsif tg_table_name = 'tasks' then
      if r_new->>'status' = 'done' and r_old->>'status' is distinct from 'done' then
        perform events._insert(v_tenant, v_ws, 'task.completed', v_obj, v_oid, '{}'::jsonb);
      end if;
    end if;
  elsif tg_op = 'INSERT' then
    if tg_table_name = 'messages' then
      perform events._insert(v_tenant, v_ws, case when r_new->>'direction' = 'inbound' then 'message.received' else 'message.sent' end,
                             v_obj, v_oid, jsonb_build_object('after', jsonb_build_object('conversation_id', r_new->'conversation_id', 'direction', r_new->'direction')));
    elsif tg_table_name = 'activities' then
      perform events._insert(v_tenant, v_ws, 'activity.logged', v_obj, v_oid, '{}'::jsonb);
    end if;
  end if;
  return coalesce(new, old);
end $$;

-- ---------- 2. audit_log: field names always, values only for structural columns ----------
create or replace function private.audit_scrub_value(p_key text, p_value jsonb) returns jsonb
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p_value is null or p_value = 'null'::jsonb then p_value
    when p_key = any (array['id', 'status', 'role', 'base_role', 'is_active', 'is_system', 'is_synthetic', 'is_decision_maker', 'enabled', 'source', 'kind',
                            'priority', 'score', 'plan', 'version', 'direction', 'channel', 'customer_status', 'preferred_language', 'mode', 'type',
                            'purpose', 'action', 'scope', 'permission_key', 'value_inr', 'budget_inr', 'seats', 'personal_email',
                            'consent_demo_followup', 'consent_whatsapp', 'consent_marketing'])
         and jsonb_typeof(p_value) in ('string', 'number', 'boolean') and length(p_value #>> '{}') <= 80 then p_value
    when p_key ~ '_id$' and jsonb_typeof(p_value) = 'string'
         and (p_value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_value
    when p_key ~ '(_at|_on)$' and jsonb_typeof(p_value) = 'string' and length(p_value #>> '{}') <= 40 then p_value
    else '"[redacted]"'::jsonb end $$;
revoke all on function private.audit_scrub_value(text, jsonb) from public, anon, authenticated;

create or replace function public.audit_row_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r     jsonb := coalesce(r_new, r_old);
  diff  jsonb;
  v_ws  uuid := coalesce((r->>'workspace_id')::uuid, case when tg_table_name = 'workspaces' then (r->>'id')::uuid end);
  v_ss  uuid;
  v_ip  inet;
  v_kind text; v_src text;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('old', private.audit_scrub_value(n.key, o.value), 'new', private.audit_scrub_value(n.key, n.value)))
      into diff
      from jsonb_each(r_new) n join jsonb_each(r_old) o using (key)
     where n.value is distinct from o.value and n.key not in ('updated_at');
    if diff is null then return new; end if;
  else
    select jsonb_object_agg(key, private.audit_scrub_value(key, value)) into diff from jsonb_each(r);
  end if;
  if auth.uid() is not null and v_ws is not null then
    select s.id into v_ss from public.support_sessions s
     where s.admin_id = auth.uid() and s.workspace_id = v_ws and s.ended_at is null and now() < s.expires_at
     order by s.started_at desc limit 1;
  end if;
  begin v_ip := nullif(current_setting('app.client_ip', true), '')::inet; exception when others then v_ip := null; end;
  v_kind := coalesce(nullif(current_setting('app.actor_kind', true), ''),
                     case when v_ss is not null then 'support' when auth.uid() is null then 'system' else 'user' end);
  if v_kind not in ('user', 'api_key', 'system', 'connector', 'agent', 'support', 'platform_admin') then v_kind := 'system'; end if;
  v_src := coalesce(nullif(current_setting('app.audit_source', true), ''),
                    case when v_ss is not null then 'support' when auth.uid() is null then 'job' else 'ui' end);
  if v_src not in ('ui', 'api', 'connector', 'job', 'agent', 'support') then v_src := 'ui'; end if;
  insert into public.audit_log (tenant_id, workspace_id, actor_id, actor_label, action, table_name, row_id, changes, support_session_id,
                                actor_kind, source, request_id, ip, user_agent, reason, summary)
  values (
    coalesce((r->>'tenant_id')::uuid, case when tg_table_name = 'tenants' then (r->>'id')::uuid end),
    v_ws, auth.uid(),
    coalesce(nullif(current_setting('app.actor_label', true), ''),
             case when v_ss is not null then 'support' when auth.uid() is null then 'service' else 'user' end),
    lower(tg_op), tg_table_name, coalesce(r->>'id', r->>'user_id'), diff, v_ss,
    v_kind, v_src, nullif(current_setting('app.request_id', true), ''), v_ip,
    left(nullif(current_setting('app.user_agent', true), ''), 300),
    left(nullif(current_setting('app.audit_reason', true), ''), 500),
    coalesce(left(nullif(current_setting('app.audit_summary', true), ''), 300), lower(tg_op) || ' ' || tg_table_name));
  return coalesce(new, old);
end $$;

-- ---------- 3. consent_log: append-only for every role ----------
revoke update, delete, truncate on public.consent_log from public, anon, authenticated, service_role;

create or replace function private.consent_log_append_only() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'TRUNCATE' then raise exception 'consent_log is append-only' using errcode = '42501'; end if;
  -- foreign-key actions run inside the cascade (trigger depth > 1): lead / profile / workspace deletion must still work.
  -- ON DELETE SET NULL on lead_id and recorded_by is the only update allowed, and nothing else may change in that row.
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    if (to_jsonb(new) - 'lead_id' - 'recorded_by') = (to_jsonb(old) - 'lead_id' - 'recorded_by')
       and (new.lead_id is null or new.lead_id = old.lead_id) and (new.recorded_by is null or new.recorded_by = old.recorded_by) then
      return new;
    end if;
  end if;
  raise exception 'consent_log is append-only' using errcode = '42501';
end $$;
revoke all on function private.consent_log_append_only() from public, anon, authenticated;

drop trigger if exists consent_log_append_only on public.consent_log;
create trigger consent_log_append_only before update or delete on public.consent_log
  for each row execute function private.consent_log_append_only();
drop trigger if exists consent_log_no_truncate on public.consent_log;
create trigger consent_log_no_truncate before truncate on public.consent_log
  for each statement execute function private.consent_log_append_only();

-- ---------- 4. consent_log.subject_ref: salted for new rows ----------
create or replace function private.consent_salt() returns text language sql stable security definer set search_path = '' as $$
  select d.decrypted_secret from vault.decrypted_secrets d where d.name = 'consent_subject_salt' limit 1 $$;
revoke all on function private.consent_salt() from public, anon, authenticated;

-- the stored forms a lookup value can take: legacy (as given) and, once the secret exists, the salted form
create or replace function private.consent_ref_variants(p_ref text) returns text[] language plpgsql stable security definer set search_path = '' as $$
declare v_salt text := private.consent_salt();
begin
  if p_ref is null then return array[]::text[]; end if;
  if v_salt is null or p_ref like 'h1:%' or p_ref !~ '^[a-f0-9]{32,128}$' then return array[p_ref]; end if;
  return array[p_ref, 'h1:' || encode(extensions.hmac(convert_to(p_ref, 'utf8'), convert_to(v_salt, 'utf8'), 'sha256'), 'hex')];
end $$;
revoke all on function private.consent_ref_variants(text) from public, anon, authenticated;

create or replace function private.consent_subject_salt_tg() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_salt text;
begin
  if new.subject_ref ~ '^[a-f0-9]{32,128}$' then
    v_salt := private.consent_salt();
    if v_salt is not null then
      new.subject_ref := 'h1:' || encode(extensions.hmac(convert_to(new.subject_ref, 'utf8'), convert_to(v_salt, 'utf8'), 'sha256'), 'hex');
    end if;
  end if;
  return new;
end $$;
revoke all on function private.consent_subject_salt_tg() from public, anon, authenticated;

drop trigger if exists a05_consent_subject_salt on public.consent_log;
create trigger a05_consent_subject_salt before insert on public.consent_log
  for each row execute function private.consent_subject_salt_tg();

-- Reads consent rows for one subject (legacy and salted forms) with the same visibility as the table's select policy
-- (data_health.read) or the service role. The HMAC itself is never exposed, so this is not a hashing oracle.
create or replace function public.consent_log_for_subject(p_workspace uuid, p_ref text)
returns setof public.consent_log language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  elsif p_workspace is null or p_workspace not in (select authz.ws_with('data_health.read', 'own')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query select c.* from public.consent_log c
    where c.workspace_id = p_workspace and c.subject_ref = any (private.consent_ref_variants(p_ref));
end $$;
revoke all on function public.consent_log_for_subject(uuid, text) from public, anon;
grant execute on function public.consent_log_for_subject(uuid, text) to authenticated, service_role;
