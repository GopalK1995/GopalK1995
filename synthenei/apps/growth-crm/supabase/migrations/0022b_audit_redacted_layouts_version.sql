-- 0022b (T041): value-free audit triggers for the T033 tables, and the layouts version trigger.
-- Additive and idempotent. audit_row_change() stores column values (records.data would leak customer data into audit_log);
-- this variant stores field NAMES only (changed top-level columns, changed keys inside records.data), never values.

create or replace function public.audit_row_change_redacted()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r     jsonb := coalesce(r_new, r_old);
  v_cols text[]; v_data text[]; v_changes jsonb;
  v_ws uuid := (r->>'workspace_id')::uuid;
  v_ss uuid; v_ip inet; v_kind text; v_src text;
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key order by n.key), '{}') into v_cols
      from jsonb_each(r_new) n join jsonb_each(r_old) o using (key)
     where n.value is distinct from o.value and n.key not in ('updated_at', 'version');
    if coalesce(array_length(v_cols, 1), 0) = 0 then return new; end if;
    if r_new ? 'data' and r_new->'data' is distinct from r_old->'data' and jsonb_typeof(r_new->'data') = 'object' and jsonb_typeof(r_old->'data') = 'object' then
      select coalesce(array_agg(k order by k), '{}') into v_data
        from (select key k from jsonb_each(r_new->'data') n
               where not (r_old->'data' ? key) or r_old->'data'->key is distinct from n.value
              union
              select key from jsonb_each(r_old->'data') where not (r_new->'data' ? key)) x;
    end if;
    v_changes := jsonb_build_object('fields', to_jsonb(v_cols)) || case when v_data is not null then jsonb_build_object('data_keys', to_jsonb(v_data)) else '{}'::jsonb end;
  else
    v_changes := jsonb_build_object('fields', (select coalesce(jsonb_agg(key order by key), '[]'::jsonb) from jsonb_each(r) where key <> 'data' and value <> 'null'::jsonb))
      || case when r ? 'data' and jsonb_typeof(r->'data') = 'object' then jsonb_build_object('data_keys', (select coalesce(jsonb_agg(key order by key), '[]'::jsonb) from jsonb_each(r->'data'))) else '{}'::jsonb end;
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
  values ((r->>'tenant_id')::uuid, v_ws, auth.uid(),
          coalesce(nullif(current_setting('app.actor_label', true), ''),
                   case when v_ss is not null then 'support' when auth.uid() is null then 'service' else 'user' end),
          lower(tg_op), tg_table_name, r->>'id', v_changes, v_ss, v_kind, v_src,
          nullif(current_setting('app.request_id', true), ''), v_ip,
          left(nullif(current_setting('app.user_agent', true), ''), 300),
          left(nullif(current_setting('app.audit_reason', true), ''), 500),
          coalesce(left(nullif(current_setting('app.audit_summary', true), ''), 300), lower(tg_op) || ' ' || tg_table_name));
  return coalesce(new, old);
end $$;
revoke all on function public.audit_row_change_redacted() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['records', 'record_links', 'object_types', 'layouts', 'saved_views'] loop
    if to_regclass('public.' || t) is not null
       and not exists (select 1 from pg_trigger where tgname = 'trg_' || t || '_audit' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change_redacted()', 'trg_' || t || '_audit', t);
    end if;
  end loop;
end $$;

-- layouts: version (optimistic token) and updated_at maintained by the database. The app also writes version + 1; bump_version() gives the same number.
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_layouts_updated' and tgrelid = 'public.layouts'::regclass) then
    create trigger trg_layouts_updated before update on public.layouts for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'z9_layouts_version' and tgrelid = 'public.layouts'::regclass) then
    create trigger z9_layouts_version before update on public.layouts for each row execute function public.bump_version();
  end if;
end $$;
