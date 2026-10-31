-- Rollback for 0019_connector_domain (BUILD-PLAN 6.5). Run 0020_down.sql first. Enum labels added to conv_channel / msg_status
-- (instagram, sms, gbp, pending_template) cannot be removed in PostgreSQL and stay (unused labels are harmless).
-- Function shapes of invite_member / _add_member_or_invite / handle_new_auth_user / admin_workspace_stats /
-- admin_set_tenant_status are restored to their 0005 / 0007 forms. start_support_session keeps the tenant_id fix (the 0007
-- version cannot insert under the 0004 NOT NULL) and territories keep their key.
begin;
drop function if exists public.audit_record(uuid, text, text, text, text, text, jsonb, text, text, text, text, text, boolean);
drop function if exists public.move_deal(uuid, uuid, int, jsonb);
drop function if exists public.merge_accounts(uuid, uuid, int, int);
drop function if exists public.save_role(uuid, text, jsonb, timestamptz, uuid, public.app_role, text);
drop function if exists public.admin_set_tenant_branding(uuid, jsonb, text);
drop function if exists public.admin_set_connector_availability(text, text, text, text, text, text);
drop function if exists public.seed_hospitality_booking(uuid);
drop trigger if exists trg_tenant_config_preset_seed on public.tenant_config;
drop function if exists metadata.tenant_config_preset_seed();
drop function if exists metadata.seed_hospitality_booking(uuid);
drop trigger if exists z5_memberships_last_owner on public.memberships;
drop function if exists authz.memberships_last_owner();
drop table if exists public.email_identities, public.import_jobs, public.ad_accounts, public.reviews, public.calendar_events,
  public.payments, public.wa_numbers;
drop function if exists private.reviews_reply_guard();
delete from public.role_permissions where permission_key = 'audit.export';
delete from public.permissions where key = 'audit.export';
alter table public.campaign_daily_metrics
  drop column if exists integration_id, drop column if exists external_campaign_id;
drop index if exists public.message_templates_provider_id;
alter table public.message_templates drop constraint if exists message_templates_status_check, drop constraint if exists message_templates_components_check,
  drop column if exists provider_template_id, drop column if exists status, drop column if exists components,
  drop column if exists integration_id, drop column if exists rejected_reason;

drop function if exists public.invite_member(uuid, text, public.app_role, text, text[], uuid);
drop function if exists public._add_member_or_invite(uuid, text, public.app_role, text, text[], uuid);
alter table public.invitations drop column if exists role_id;
create or replace function public._add_member_or_invite(p_ws uuid, p_email text, p_role public.app_role, p_full_name text, p_districts text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_inv uuid; v_email text := lower(trim(p_email));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' or length(v_email) > 160 then raise exception 'invalid email' using errcode = '22023'; end if;
  select u.id into v_user from auth.users u where lower(u.email) = v_email and u.email_confirmed_at is not null;
  if v_user is not null then
    insert into public.profiles (id, full_name, email, last_workspace_id)
    values (v_user, coalesce(nullif(trim(p_full_name), ''), split_part(v_email, '@', 1)), v_email, p_ws) on conflict (id) do nothing;
    insert into public.memberships (user_id, workspace_id, role, invited_by) values (v_user, p_ws, p_role, auth.uid())
    on conflict (user_id, workspace_id) do update set role = excluded.role, is_active = true;
    insert into public.territories (workspace_id, district, rep_id) select p_ws, d, v_user from unnest(coalesce(p_districts, '{}')) d
    on conflict (workspace_id, district) do update set rep_id = excluded.rep_id;
    if p_role = 'owner' then
      update public.tenants t set primary_owner_id = v_user
       where t.id = (select w.tenant_id from public.workspaces w where w.id = p_ws) and t.primary_owner_id is null;
    end if;
    return jsonb_build_object('status', 'member_added', 'user_id', v_user);
  end if;
  delete from public.invitations where workspace_id = p_ws and lower(email) = v_email and accepted_at is null;
  insert into public.invitations (workspace_id, email, full_name, role, territory_districts, invited_by)
  values (p_ws, v_email, nullif(trim(p_full_name), ''), p_role, coalesce(p_districts, '{}'), (select p.id from public.profiles p where p.id = auth.uid()))
  returning id into v_inv;
  return jsonb_build_object('status', 'invited', 'invitation_id', v_inv);
end $$;
revoke all on function public._add_member_or_invite(uuid, text, public.app_role, text, text[]) from public, anon, authenticated;
create or replace function public.invite_member(p_ws uuid, p_email text, p_role public.app_role, p_full_name text default null, p_districts text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not (p_ws in (select public.member_role_ws_ids('owner'))
          or (p_ws in (select public.member_role_ws_ids('sales_manager')) and p_role in ('sales_rep','viewer'))
          or (public.is_platform_admin() and p_role = 'owner'
              and not exists (select 1 from public.memberships m where m.workspace_id = p_ws and m.role = 'owner' and m.is_active))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return public._add_member_or_invite(p_ws, p_email, p_role, p_full_name, p_districts);
end $$;
grant execute on function public.invite_member(uuid, text, public.app_role, text, text[]) to authenticated;
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv record;
begin
  if new.email_confirmed_at is null then return new; end if;
  for inv in select * from public.invitations where lower(email) = lower(new.email) and accepted_at is null and expires_at > now() loop
    insert into public.profiles (id, full_name, email, last_workspace_id)
    values (new.id, coalesce(inv.full_name, split_part(new.email, '@', 1)), new.email, inv.workspace_id) on conflict (id) do nothing;
    insert into public.memberships (user_id, workspace_id, role, invited_by) values (new.id, inv.workspace_id, inv.role, inv.invited_by)
    on conflict (user_id, workspace_id) do update set role = excluded.role, is_active = true;
    insert into public.territories (workspace_id, district, rep_id) select inv.workspace_id, d, new.id from unnest(inv.territory_districts) d
    on conflict (workspace_id, district) do update set rep_id = excluded.rep_id;
    update public.invitations set accepted_at = now() where id = inv.id;
    if inv.role = 'owner' then
      update public.tenants set primary_owner_id = new.id where id = inv.tenant_id and primary_owner_id is null;
    end if;
  end loop;
  return new;
end $$;

drop function if exists public.admin_workspace_stats();
create or replace function public.admin_workspace_stats()
returns table (tenant_id uuid, tenant_name text, tenant_status text, workspace_id uuid, workspace_name text, workspace_slug text,
               members int, leads_total int, leads_30d int, integrations_attention int, failed_syncs_24h int, last_activity_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select t.id, t.name, t.status, w.id, w.name, w.slug,
         (select count(*)::int from public.memberships m where m.workspace_id = w.id and m.is_active),
         (select count(*)::int from public.leads l where l.workspace_id = w.id and l.deleted_at is null),
         (select count(*)::int from public.leads l where l.workspace_id = w.id and l.deleted_at is null and l.created_at > now() - interval '30 days'),
         (select count(*)::int from public.integrations i where i.workspace_id = w.id and i.status in ('needs_attention','error')),
         (select count(*)::int from public.sync_runs r where r.workspace_id = w.id and r.status = 'failed' and r.started_at > now() - interval '24 hours'),
         greatest((select max(a.created_at) from public.activities a where a.workspace_id = w.id), (select max(l.created_at) from public.leads l where l.workspace_id = w.id))
    from public.workspaces w join public.tenants t on t.id = w.tenant_id order by t.name, w.name;
end $$;
grant execute on function public.admin_workspace_stats() to authenticated;

drop function if exists public.admin_set_tenant_status(uuid, text, text);
create or replace function public.admin_set_tenant_status(p_tenant uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status not in ('active','suspended','archived') then raise exception 'invalid status' using errcode = '22023'; end if;
  update public.tenants set status = p_status where id = p_tenant;
end $$;
grant execute on function public.admin_set_tenant_status(uuid, text) to authenticated;
commit;
