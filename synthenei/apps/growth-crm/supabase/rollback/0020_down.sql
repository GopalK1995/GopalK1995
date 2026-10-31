-- Rollback for 0020_entitlements_billing_privacy (BUILD-PLAN 6.5). Destroys billing, usage and privacy register data:
-- take a backup first. Run on the branch DB or in a hotfix window only.
begin;
drop function if exists public.tenant_entitlements(uuid);
drop function if exists public.usage_set(uuid, text, bigint);
drop function if exists public.usage_bump(text, bigint, uuid);
drop trigger if exists trg_tenants_subscription on public.tenants;
drop function if exists private.tenant_subscription_default();
drop table if exists public.retention_policies, public.privacy_requests, public.usage_counters, public.invoices,
  public.invoice_series, public.tenant_subscriptions, public.plans;
drop function if exists private.privacy_request_defaults();
drop function if exists private.invoices_guard();
drop function if exists private.next_invoice_number(date);
drop function if exists authz.platform_role_in(text[]);
alter table public.tenants drop constraint if exists tenants_privacy_response_days_check, drop constraint if exists tenants_dpo_contact_check,
  drop column if exists trial_ends_at, drop column if exists data_region, drop column if exists dpo_contact, drop column if exists privacy_response_days;
commit;
