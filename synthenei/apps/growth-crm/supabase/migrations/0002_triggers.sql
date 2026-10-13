-- 0002 trigger functions + triggers (updated_at, audit, profile guard, signup->profile, lead assignment, deal stages)
-- Derived from apps/growth-crm/supabase/schema.sql. Apply in filename order.

-- =====================================================================
-- 16. Trigger functions
-- =====================================================================
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['tenants','profiles','accounts','contacts','campaigns','audience_segments',
                           'leads','deals','tasks','integrations'] loop
    execute format('create trigger trg_%1$s_updated before update on public.%1$I
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- Generic audit trigger (append-only audit_log).
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r     jsonb := coalesce(r_new, r_old);
  diff  jsonb;
  -- PII columns: the audit log records THAT they changed, never their values, so a DPDP erasure
  -- of the source row leaves no personal data behind in this append-only table.
  pii   text[] := array['full_name','email','phone','body','note','address_line','firm_name','display_name'];
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
      into diff from jsonb_each(coalesce(r_new, r_old));
  end if;
  insert into public.audit_log (tenant_id, actor_id, actor_label, action, table_name, row_id, changes)
  values (
    coalesce((r->>'tenant_id')::uuid, case when tg_table_name = 'tenants' then (r->>'id')::uuid end),
    auth.uid(),
    coalesce(nullif(current_setting('app.actor_label', true), ''), case when auth.uid() is null then 'service' else 'user' end),
    lower(tg_op), tg_table_name, r->>'id', diff);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['tenants','profiles','invitations','accounts','contacts','leads','deals',
                           'pipeline_stages','territories','integrations','integration_field_maps','consent_log'] loop
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- Privilege-escalation guard on profiles.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me public.app_role := public.current_app_role();
begin
  if auth.uid() is null then return new; end if;                 -- service role / SQL editor
  if new.tenant_id <> old.tenant_id or new.id <> old.id or new.email <> old.email then
    raise exception 'tenant, id and email cannot be changed here';
  end if;
  if new.role <> old.role or new.is_active <> old.is_active then
    if new.id = auth.uid() then
      raise exception 'you cannot change your own role or active status';
    elsif me = 'owner' then
      null;
    elsif me = 'sales_manager' and old.role in ('sales_rep','viewer') and new.role in ('sales_rep','viewer') then
      null;
    else
      raise exception 'not allowed to change role or status';
    end if;
  end if;
  return new;
end $$;
create trigger trg_profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- New auth user -> profile only if a pending, unexpired invitation exists.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv public.invitations;
begin
  -- Only confirmed addresses can claim an invitation (blocks sign-up-as-invitee if confirmations are off).
  if new.email_confirmed_at is null then return new; end if;
  if exists (select 1 from public.profiles where id = new.id) then return new; end if;
  select * into inv from public.invitations
   where lower(email) = lower(new.email) and accepted_at is null and expires_at > now()
   order by created_at desc limit 1;
  if inv.id is null then return new; end if;     -- no invite: no profile, no access
  insert into public.profiles (id, tenant_id, full_name, email, role)
  values (new.id, inv.tenant_id, coalesce(inv.full_name, split_part(new.email, '@', 1)), new.email, inv.role)
  on conflict (id) do nothing;
  insert into public.territories (tenant_id, district, rep_id)
  select inv.tenant_id, d, new.id from unnest(inv.territory_districts) d
  on conflict (tenant_id, district) do update set rep_id = excluded.rep_id;
  update public.invitations set accepted_at = now() where id = inv.id;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_new_auth_user();

-- Lead auto-assignment by district territory + first-response task.
create or replace function public.lead_assign_on_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id is null and new.district is not null then
    select t.rep_id into new.owner_id
      from public.territories t join public.profiles p on p.id = t.rep_id and p.is_active
     where t.tenant_id = new.tenant_id and lower(t.district) = lower(new.district);
  end if;
  if new.owner_id is not null and new.assigned_at is null then new.assigned_at := now(); end if;
  return new;
end $$;
create trigger trg_leads_assign before insert on public.leads
  for each row execute function public.lead_assign_on_insert();

create or replace function public.lead_first_response_task() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sla int;
begin
  if new.owner_id is not null and new.first_response_at is null
     and (tg_op = 'INSERT' or old.owner_id is distinct from new.owner_id) then
    if tg_op = 'UPDATE' then new.assigned_at := now(); end if;
    select sla_first_response_mins into sla from public.tenants where id = new.tenant_id;
    -- Wall-clock due time; business-hours SLA (M14) is computed in the app/report layer.
    insert into public.tasks (tenant_id, lead_id, title, kind, priority, assignee_id, due_at)
    values (new.tenant_id, new.id, 'First response: ' || new.full_name, 'first_response', 1,
            new.owner_id, now() + make_interval(mins => coalesce(sla, 120)));
  end if;
  return new;
end $$;
create trigger trg_leads_first_task_ins after insert on public.leads
  for each row execute function public.lead_first_response_task();
create trigger trg_leads_first_task_upd before update of owner_id on public.leads
  for each row execute function public.lead_first_response_task();

-- Logging an outbound touch sets first_response_at / last_touch_at on the lead.
create or replace function public.activity_touch_lead() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.lead_id is not null and new.kind in ('call','whatsapp','email','meeting')
     and coalesce(new.direction, 'outbound') = 'outbound' then
    update public.leads
       set first_response_at = coalesce(first_response_at, new.created_at),
           last_touch_at = greatest(coalesce(last_touch_at, new.created_at), new.created_at),
           status = case when status = 'new' then 'contacted'::public.lead_status else status end
     where id = new.lead_id and tenant_id = new.tenant_id;
    update public.tasks set status = 'done', completed_at = now()
     where lead_id = new.lead_id and kind = 'first_response' and status = 'open';
  end if;
  return new;
end $$;
create trigger trg_activities_touch after insert on public.activities
  for each row execute function public.activity_touch_lead();

-- Deal stage bookkeeping + history (feeds M36, M41).
create or replace function public.deal_stage_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare st public.pipeline_stages;
begin
  select * into st from public.pipeline_stages where id = new.stage_id;
  if st.tenant_id <> new.tenant_id then raise exception 'stage belongs to another tenant'; end if;
  if tg_op = 'INSERT' or new.stage_id <> old.stage_id then
    new.stage_entered_at := now();
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
create trigger trg_deals_stage before insert or update of stage_id on public.deals
  for each row execute function public.deal_stage_change();

create or replace function public.deal_stage_history_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.stage_id <> old.stage_id then
    insert into public.deal_stage_history (tenant_id, deal_id, from_stage_id, to_stage_id, changed_by)
    values (new.tenant_id, new.id, case when tg_op = 'UPDATE' then old.stage_id end, new.stage_id, auth.uid());
  end if;
  return new;
end $$;
create trigger trg_deals_history after insert or update of stage_id on public.deals
  for each row execute function public.deal_stage_history_write();
