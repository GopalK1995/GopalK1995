-- 0023_tenants_update_guard.sql  (AUD-010 / SEC-001, BLOCKER)
-- Problem: 0009 granted table-wide UPDATE on public.tenants to `authenticated` and the tenants_update policy lets the primary owner
-- through, so any owner could PATCH plan, status, trial_ends_at, primary_owner_id (and ai_*, custom_domain, data_region, is_demo, slug)
-- straight through PostgREST: free plan upgrades, un-suspending a suspended org, extending a trial forever, handing over ownership.
-- Fix, two layers (idempotent, safe to re-run):
--   1. Column-level privileges: revoke the broad UPDATE, re-grant UPDATE only on the columns an owner may legitimately edit.
--      Found by searching every writer of tenants: the only app-side write is brand_name/brand_primary (admin/_lib/repo.ts); every other
--      write goes through SECURITY DEFINER RPCs (admin_set_tenant_branding, admin_set_status, invite acceptance, admin_create_tenant)
--      that run as the function owner and are unaffected by the revoke. custom_domain, ai_enabled and ai_monthly_call_cap are NOT
--      re-granted: nothing in the app writes them with a user JWT (AI limits live in public.ai_policies); they stay service/definer only.
--   2. BEFORE UPDATE trigger as a second guard: even if a future migration re-grants too much, a direct API caller (role authenticated
--      or anon) who is not a platform admin cannot change status, plan, trial_ends_at, primary_owner_id (nor the other protected columns).
--      SECURITY DEFINER functions (current_user = their owner) and the service role are not affected.
--
-- ROLLBACK (manual, only if branding saves break):
--   drop trigger if exists trg_tenants_guard on public.tenants;
--   drop function if exists private.tenants_guard();
--   grant update on public.tenants to authenticated;   -- restores the vulnerable state of 0009; prefer fixing forward.

revoke update on public.tenants from authenticated;
revoke update on public.tenants from anon;

grant update (brand_name, brand_primary, brand_accent, brand_logo_url, brand_logo_dark_url, brand_favicon_url,
              support_email, email_sender_name, timezone, currency, privacy_response_days, dpo_contact)
  on public.tenants to authenticated;

create schema if not exists private;

create or replace function private.tenants_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  -- Only direct API callers are restricted. SECURITY DEFINER RPCs run as their owner (postgres), the service role as service_role.
  if current_user in ('authenticated', 'anon')
     and coalesce(auth.role(), '') <> 'service_role'
     and not coalesce(public.is_platform_admin(), false) then
    if new.status is distinct from old.status
       or new.plan is distinct from old.plan
       or new.trial_ends_at is distinct from old.trial_ends_at
       or new.primary_owner_id is distinct from old.primary_owner_id
       or new.is_demo is distinct from old.is_demo
       or new.slug is distinct from old.slug
       or new.custom_domain is distinct from old.custom_domain
       or new.data_region is distinct from old.data_region
       or new.ai_enabled is distinct from old.ai_enabled
       or new.ai_monthly_call_cap is distinct from old.ai_monthly_call_cap then
      raise exception 'tenants: status, plan, trial, ownership and platform flags can only be changed by a platform administrator'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.tenants_guard() from public, anon, authenticated;

drop trigger if exists trg_tenants_guard on public.tenants;
create trigger trg_tenants_guard before update on public.tenants
  for each row execute function private.tenants_guard();
