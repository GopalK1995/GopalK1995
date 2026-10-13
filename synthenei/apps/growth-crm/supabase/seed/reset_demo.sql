-- Removes the demo tenants (cascades to workspaces, memberships and every business row) and the demo
-- project-wide backup rows, so seed/seed.sql can be loaded again. Run as postgres/service role.
-- Destructive: never point this at a project with real tenants named 'lawsome' or 'kaveri-demo'.
begin;
delete from public.tenants where slug in ('lawsome', 'kaveri-demo') and is_demo;
delete from public.backup_checks where workspace_id is null and location like 'demo:%';
delete from public.backup_alert_rules where workspace_id is null and notify_to like 'demo:%';
commit;
