-- 0005 trigger functions rewritten for the workspace model.

-- updated_at on new tables
create trigger trg_workspaces_updated before update on public.workspaces
  for each row execute function public.set_updated_at();
create trigger trg_memberships_updated before update on public.memberships
  for each row execute function public.set_updated_at();

-- Audit: adds workspace_id and, when a platform admin writes inside an active support session,
-- support_session_id. PII columns are stored as "[pii]" (DPDP erasure leaves nothing behind).
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r     jsonb := coalesce(r_new, r_old);
  diff  jsonb;
  pii   text[] := array['full_name','email','phone','body','note','address_line','firm_name','display_name'];
  v_ws  uuid := coalesce((r->>'workspace_id')::uuid, case when tg_table_name = 'workspaces' then (r->>'id')::uuid end);
  v_ss  uuid;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value))
      into diff
      from jsonb_each(r_new) n join jsonb_each(r_old) o using (key)
     where n.value is distinct from o.value and n.key not in ('updated_at');
    if diff is null then return new; end if;
    select jsonb_object_agg(key, case when key = any(pii) then '{"old":"[pii]","new":"[pii]"}'::jsonb else value end)
      into diff from jsonb_each(diff);
  else
    select jsonb_object_agg(key, case when key = any(pii) and value <> 'null'::jsonb then '"[pii]"'::jsonb else value end)
      into diff from jsonb_each(r);
  end if;
  if auth.uid() is not null and v_ws is not null then
    select s.id into v_ss from public.support_sessions s
     where s.admin_id = auth.uid() and s.workspace_id = v_ws and s.ended_at is null and now() < s.expires_at
     order by s.started_at desc limit 1;
  end if;
  insert into public.audit_log (tenant_id, workspace_id, actor_id, actor_label, action, table_name, row_id, changes, support_session_id)
  values (
    coalesce((r->>'tenant_id')::uuid, case when tg_table_name = 'tenants' then (r->>'id')::uuid end),
    v_ws, auth.uid(),
    coalesce(nullif(current_setting('app.actor_label', true), ''),
             case when v_ss is not null then 'support' when auth.uid() is null then 'service' else 'user' end),
    lower(tg_op), tg_table_name, coalesce(r->>'id', r->>'user_id'), diff, v_ss);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['workspaces','memberships','platform_admins','support_sessions','activities','tasks',
                           'campaigns','sales_targets','messages'] loop
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- Profiles: users edit their own name/phone/language/last_workspace_id; id and email are fixed.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;                 -- service role / SQL editor
  if new.id <> old.id or new.email <> old.email or new.is_active <> old.is_active then
    raise exception 'id, email and active status cannot be changed here' using errcode = '42501';
  end if;
  if new.last_workspace_id is not null and new.last_workspace_id is distinct from old.last_workspace_id
     and not public.is_member(new.last_workspace_id) then
    raise exception 'not a member of that workspace' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Memberships: no self role/status change; sales_manager only moves rep/viewer within rep/viewer;
-- owner (or a read_write support session) may change anything; workspace/user are immutable.
create or replace function public.guard_membership_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me public.app_role;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  -- real membership role only: support sessions never manage people
  select m.role into me from public.memberships m
   where m.user_id = auth.uid() and m.workspace_id = coalesce(new.workspace_id, old.workspace_id) and m.is_active;
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.workspace_id <> old.workspace_id then
      raise exception 'user and workspace cannot be changed' using errcode = '42501';
    end if;
    if new.role = old.role and new.is_active = old.is_active then return new; end if;
    if new.user_id = auth.uid() then
      raise exception 'you cannot change your own role or active status' using errcode = '42501';
    end if;
  end if;
  if me = 'owner' or public.is_platform_admin() then   -- platform admin: tenant/workspace bootstrap from /admin
    return coalesce(new, old);
  elsif tg_op = 'INSERT' and new.user_id = auth.uid() and new.role = 'owner'
        and new.tenant_id in (select public.owner_tenant_ids()) then   -- tenant owner seats self in a new workspace
    return new;
  elsif me = 'sales_manager'
        and (tg_op = 'INSERT' or old.role in ('sales_rep','viewer'))
        and (tg_op = 'DELETE' or new.role in ('sales_rep','viewer')) then
    return coalesce(new, old);
  end if;
  raise exception 'not allowed to change memberships here' using errcode = '42501';
end $$;
create trigger trg_memberships_guard before insert or update or delete on public.memberships
  for each row execute function public.guard_membership_change();

-- Signup / invite acceptance: confirmed email + pending invitation -> profile (once) + membership.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv record;
begin
  if new.email_confirmed_at is null then return new; end if;
  for inv in
    select * from public.invitations
     where lower(email) = lower(new.email) and accepted_at is null and expires_at > now()
  loop
    insert into public.profiles (id, full_name, email, last_workspace_id)
    values (new.id, coalesce(inv.full_name, split_part(new.email, '@', 1)), new.email, inv.workspace_id)
    on conflict (id) do nothing;
    insert into public.memberships (user_id, workspace_id, role, invited_by)
    values (new.id, inv.workspace_id, inv.role, inv.invited_by)
    on conflict (user_id, workspace_id) do update set role = excluded.role, is_active = true;
    insert into public.territories (workspace_id, district, rep_id)
    select inv.workspace_id, d, new.id from unnest(inv.territory_districts) d
    on conflict (workspace_id, district) do update set rep_id = excluded.rep_id;
    update public.invitations set accepted_at = now() where id = inv.id;
    if inv.role = 'owner' then
      update public.tenants set primary_owner_id = new.id where id = inv.tenant_id and primary_owner_id is null;
    end if;
  end loop;
  return new;
end $$;

-- Lead auto-assignment by district territory inside the lead's workspace.
create or replace function public.lead_assign_on_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id is null and new.district is not null then
    select t.rep_id into new.owner_id
      from public.territories t
      join public.memberships m on m.user_id = t.rep_id and m.workspace_id = t.workspace_id and m.is_active
     where t.workspace_id = new.workspace_id and lower(t.district) = lower(new.district);
  end if;
  if new.owner_id is not null and new.assigned_at is null then new.assigned_at := now(); end if;
  return new;
end $$;

-- First-response task uses the workspace SLA.
create or replace function public.lead_first_response_task() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sla int;
begin
  if new.owner_id is not null and new.first_response_at is null
     and (tg_op = 'INSERT' or old.owner_id is distinct from new.owner_id) then
    if tg_op = 'UPDATE' then new.assigned_at := now(); end if;
    select w.sla_first_response_mins into sla from public.workspaces w where w.id = new.workspace_id;
    insert into public.tasks (workspace_id, lead_id, title, kind, priority, assignee_id, due_at)
    values (new.workspace_id, new.id, 'First response: ' || new.full_name, 'first_response', 1,
            new.owner_id, now() + make_interval(mins => coalesce(sla, 120)));
  end if;
  return new;
end $$;

create or replace function public.activity_touch_lead() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.lead_id is not null and new.kind in ('call','whatsapp','email','meeting')
     and coalesce(new.direction, 'outbound') = 'outbound' then
    update public.leads
       set first_response_at = coalesce(first_response_at, new.created_at),
           last_touch_at = greatest(coalesce(last_touch_at, new.created_at), new.created_at),
           status = case when status = 'new' then 'contacted'::public.lead_status else status end
     where id = new.lead_id and workspace_id = new.workspace_id;
    update public.tasks set status = 'done', completed_at = now()
     where lead_id = new.lead_id and workspace_id = new.workspace_id and kind = 'first_response' and status = 'open';
  end if;
  return new;
end $$;

create or replace function public.deal_stage_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare st public.pipeline_stages;
begin
  select * into st from public.pipeline_stages where id = new.stage_id;
  if st.workspace_id is distinct from new.workspace_id then raise exception 'stage belongs to another workspace'; end if;
  if tg_op = 'INSERT' or new.stage_id <> old.stage_id then
    new.stage_entered_at := case when tg_op = 'INSERT' then coalesce(new.stage_entered_at, now()) else now() end;
    new.won_at  := case when st.is_won  then coalesce(new.won_at, now())  end;
    new.lost_at := case when st.is_lost then coalesce(new.lost_at, now()) end;
    if st.is_won and (new.value_inr <= 0 or new.seats is null) then
      raise exception 'won deals need value_inr > 0 and seats';
    end if;
    if st.is_lost and new.lost_reason is null then
      raise exception 'lost deals need lost_reason';
    end if;
  end if;
  return new;
end $$;

create or replace function public.deal_stage_history_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.stage_id <> old.stage_id then
    insert into public.deal_stage_history (workspace_id, deal_id, from_stage_id, to_stage_id, changed_by, changed_at)
    values (new.workspace_id, new.id, case when tg_op = 'UPDATE' then old.stage_id end, new.stage_id, auth.uid(),
            case when tg_op = 'INSERT' then new.stage_entered_at else now() end);
  end if;
  return new;
end $$;

-- Platform admins and workspace members are disjoint identities (spec 10.5): an operator who also works
-- in a workspace uses a separate account.
create or replace function public.guard_admin_member_exclusive() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'memberships' and exists (select 1 from public.platform_admins where user_id = new.user_id) then
    raise exception 'platform admins cannot hold workspace memberships' using errcode = '23514';
  elsif tg_table_name = 'platform_admins' and exists (select 1 from public.memberships where user_id = new.user_id) then
    raise exception 'workspace members cannot be platform admins' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_memberships_not_admin before insert or update of user_id on public.memberships
  for each row execute function public.guard_admin_member_exclusive();
create trigger trg_platform_admins_not_member before insert or update of user_id on public.platform_admins
  for each row execute function public.guard_admin_member_exclusive();
