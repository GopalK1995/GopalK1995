-- 0033 authz_ts_sql_parity (AUD-115, AUD-148 groundwork; SEC-014). NOT applied by the agent that wrote it.
--
-- The TypeScript engine now reads catalog/system-roles.ts (SYSTEM_ROLES) as its only grant source; the parity test
-- src/lib/authz/__tests__/sql-parity.test.ts proves that 0013 (generated block) + 0016 (analytics.write) + 0019 (audit.export)
-- + THIS file produce exactly those role_permissions rows. This migration closes the one gap left: the new permission
-- leads.claim.
--
-- Owner decision (AUD-148): reps MAY claim unassigned leads (default YES).
--   owner / sales_manager: leads.claim = all   (they can already assign, claiming is the self-service case)
--   sales_rep:             leads.claim = own   (only unassigned leads inside their own territory, see the territory arm of
--                                               leads.read; the claim action itself is the claim RPC delivered with AUD-148)
-- marketing, data, viewer do not claim leads.
--
-- Safe to apply before or after the TS deploy: the TS side treats a missing leads.claim grant as "no permission" (deny), so
-- until this is applied reps simply do not see the Claim action. Idempotent; no data is changed other than the seed rows.
-- Also note (no change here): "sales_manager may grant only roles below their own" is already enforced in SQL by
-- guard_membership_change (0013: sales_rep and viewer only) and role_within_caller; the TS twin is MANAGER_SCOPE in
-- src/lib/authz/role-hierarchy.ts, pinned to that literal by the parity test.
begin;

insert into public.permissions (key, resource, action, description, is_pii, platform_only, support_blocked) values
  ('leads.claim', 'leads', 'claim', 'Claim unassigned leads in own territory', false, false, false)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key, scope)
select r.id, 'leads.claim', case r.key when 'sales_rep' then 'own' else 'all' end
  from public.roles r
 where r.tenant_id is null and r.is_system and r.key in ('owner', 'sales_manager', 'sales_rep')
on conflict (role_id, permission_key) do update set scope = excluded.scope;

do $$
begin
  assert (select count(*) from public.role_permissions rp join public.roles r on r.id = rp.role_id
           where r.tenant_id is null and r.is_system and rp.permission_key = 'leads.claim') = 3, '0033: leads.claim seeded for three system roles';
  assert (select rp.scope from public.role_permissions rp join public.roles r on r.id = rp.role_id
           where r.tenant_id is null and r.is_system and r.key = 'sales_rep' and rp.permission_key = 'leads.claim') = 'own', '0033: rep claims own';
end $$;

commit;
