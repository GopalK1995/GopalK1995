-- 0030 consent_hmac_pepper (AUD-034; PRIV-008, PRIV-009). Owner decision: HMAC-SHA256 keyed by a PER-TENANT secret in Supabase Vault.
-- Phase 1 of 2 (dual-write). Phase 2 is 0031_consent_hmac_backfill.sql (rehash old rows). NOT applied by the agent that wrote it.
--
--   PRIV-009 consent_log.subject_ref was an unsalted sha256 (enumerable offline), then 'h1:' + HMAC with ONE global secret (0026).
--            From this migration new rows are 'h2:' + HMAC-SHA256(pepper of the row's tenant, the plain sha256 the app sends).
--            h1 and legacy rows stay valid for lookups until 0031 / a later retire step.
--   PRIV-008 email_suppressions stored the clear-text address and erasure kept it. New rows store ONLY email_hash
--            ('h2:' + HMAC-SHA256(tenant pepper, lower(btrim(address)))) and email stays NULL. Reads and writes go through the
--            service-role RPCs below, which match both the hash and (until 0031) a legacy clear-text row, so nothing is lost mid-way.
--
-- Pepper handling: one Vault secret per tenant named consent_pepper_<tenant uuid>, created lazily on first use by
-- private.tenant_pepper() (SECURITY DEFINER, executable by nobody but the definer). It is never selected, returned, raised in an
-- error message or logged by any function here. The existing global secret consent_subject_salt is kept only so h1 rows still match.
-- OWNER: keep an off-platform copy of the peppers (Vault backup / password manager). Losing a tenant's pepper makes that tenant's
-- 'h2:' values unmatchable, which for suppressions would mean an unsubscribed address could be mailed again.
--
-- Idempotent. ROLLBACK (manual, in this order):
--   drop function public.suppression_check(uuid, text); drop function public.suppression_add(uuid, text, text, text, uuid);
--   restore private.consent_subject_salt_tg() and public.consent_log_for_subject() from 0026 (create or replace with the 0026 bodies);
--   drop function private.consent_ref_variants(text, uuid); drop function private.subject_hmac(uuid, text); drop function private.tenant_pepper(uuid);
--   drop index email_suppressions_ws_hash; alter table public.email_suppressions drop constraint email_suppressions_hash_or_email, drop column email_hash;
--   (only if no hashed-only rows exist; otherwise the addresses are unrecoverable by design) alter column email set not null.
--   Vault secrets consent_pepper_* may stay: they hold no personal data. Rows already written as 'h2:' keep that value; app code before
--   this change cannot match them, so roll the app back first only together with 0031 never having run.

-- ---------- 1. per-tenant pepper in Vault ----------
create or replace function private.tenant_pepper(p_tenant uuid) returns text language plpgsql security definer set search_path = '' as $$
declare v_name text; v_key text;
begin
  if p_tenant is null then return null; end if;
  v_name := 'consent_pepper_' || p_tenant::text;
  select d.decrypted_secret into v_key from vault.decrypted_secrets d where d.name = v_name limit 1;
  if v_key is null then
    perform pg_advisory_xact_lock(hashtextextended(v_name, 0));          -- two writers must not both create it
    select d.decrypted_secret into v_key from vault.decrypted_secrets d where d.name = v_name limit 1;
    if v_key is null then
      perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), v_name, 'HMAC pepper for subject hashes (consent_log, email_suppressions) of one tenant');
      select d.decrypted_secret into v_key from vault.decrypted_secrets d where d.name = v_name limit 1;
    end if;
  end if;
  return v_key;
end $$;
revoke all on function private.tenant_pepper(uuid) from public, anon, authenticated, service_role;

-- 'h2:' + hex(HMAC-SHA256(pepper, value)). Raises when no pepper can be had: callers must fail closed, never store the clear value.
create or replace function private.subject_hmac(p_tenant uuid, p_value text) returns text language plpgsql security definer set search_path = '' as $$
declare v_key text := private.tenant_pepper(p_tenant);
begin
  if v_key is null then raise exception 'subject pepper unavailable' using errcode = '55000'; end if;
  return 'h2:' || encode(extensions.hmac(convert_to(p_value, 'utf8'), convert_to(v_key, 'utf8'), 'sha256'), 'hex');
end $$;
revoke all on function private.subject_hmac(uuid, text) from public, anon, authenticated, service_role;

-- ---------- 2. consent_log.subject_ref: 'h2:' for new rows, all stored forms matched on lookup ----------
create or replace function private.consent_ref_variants(p_ref text, p_tenant uuid) returns text[] language plpgsql security definer set search_path = '' as $$
declare v_salt text := private.consent_salt(); v_out text[]; v_h2 text;
begin
  if p_ref is null then return array[]::text[]; end if;
  if p_ref like 'h1:%' or p_ref like 'h2:%' or p_ref !~ '^[a-f0-9]{32,128}$' then return array[p_ref]; end if;
  v_out := array[p_ref];
  if v_salt is not null then
    v_out := v_out || ('h1:' || encode(extensions.hmac(convert_to(p_ref, 'utf8'), convert_to(v_salt, 'utf8'), 'sha256'), 'hex'));
  end if;
  begin v_h2 := private.subject_hmac(p_tenant, p_ref); exception when others then v_h2 := null; end;   -- no pepper: legacy and h1 forms only
  if v_h2 is not null then v_out := v_out || v_h2; end if;
  return v_out;
end $$;
revoke all on function private.consent_ref_variants(text, uuid) from public, anon, authenticated, service_role;

create or replace function private.consent_subject_salt_tg() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_salt text; v_tenant uuid; v_h2 text;
begin
  if new.subject_ref ~ '^[a-f0-9]{32,128}$' then
    v_tenant := coalesce(new.tenant_id, (select w.tenant_id from public.workspaces w where w.id = new.workspace_id));
    begin v_h2 := private.subject_hmac(v_tenant, new.subject_ref); exception when others then v_h2 := null; end;
    if v_h2 is not null then
      new.subject_ref := v_h2;
    else                                                    -- Vault unreachable: keep the consent write working with the 0026 behaviour
      v_salt := private.consent_salt();
      if v_salt is not null then
        new.subject_ref := 'h1:' || encode(extensions.hmac(convert_to(new.subject_ref, 'utf8'), convert_to(v_salt, 'utf8'), 'sha256'), 'hex');
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.consent_subject_salt_tg() from public, anon, authenticated;

create or replace function public.consent_log_for_subject(p_workspace uuid, p_ref text)
returns setof public.consent_log language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  if (select auth.uid()) is null then
    if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  elsif p_workspace is null or p_workspace not in (select authz.ws_with('data_health.read', 'own')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select w.tenant_id into v_tenant from public.workspaces w where w.id = p_workspace;
  return query select c.* from public.consent_log c
    where c.workspace_id = p_workspace and c.subject_ref = any (private.consent_ref_variants(p_ref, v_tenant));
end $$;
revoke all on function public.consent_log_for_subject(uuid, text) from public, anon;
grant execute on function public.consent_log_for_subject(uuid, text) to authenticated, service_role;

-- ---------- 3. email_suppressions: hash only ----------
alter table public.email_suppressions add column if not exists email_hash text;
alter table public.email_suppressions alter column email drop not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'email_suppressions_hash_or_email' and conrelid = 'public.email_suppressions'::regclass) then
    alter table public.email_suppressions add constraint email_suppressions_hash_or_email
      check ((email is not null or email_hash is not null) and (email_hash is null or email_hash ~ '^h2:[a-f0-9]{64}$'));
  end if;
end $$;
create unique index if not exists email_suppressions_ws_hash on public.email_suppressions (workspace_id, email_hash) where email_hash is not null;

-- Service role only (webhooks, the send worker, the privacy flow). The hash is computed in the database; the pepper never leaves it.
create or replace function public.suppression_check(p_workspace uuid, p_email text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_mail text := lower(btrim(p_email)); v_hash text;
begin
  select w.tenant_id into v_tenant from public.workspaces w where w.id = p_workspace;
  if v_tenant is null then return false; end if;
  v_hash := private.subject_hmac(v_tenant, v_mail);        -- raises if the pepper is unavailable: the caller fails closed
  return exists (select 1 from public.email_suppressions s where s.workspace_id = p_workspace and (s.email_hash = v_hash or s.email = v_mail));
end $$;
revoke all on function public.suppression_check(uuid, text) from public, anon, authenticated;
grant execute on function public.suppression_check(uuid, text) to service_role;

create or replace function public.suppression_add(p_workspace uuid, p_email text, p_reason text, p_source text, p_lead uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_mail text := lower(btrim(p_email)); v_hash text; v_n int;
begin
  select w.tenant_id into v_tenant from public.workspaces w where w.id = p_workspace;
  if v_tenant is null then raise exception 'unknown workspace' using errcode = '23503'; end if;
  if p_reason not in ('hard_bounce', 'complaint', 'unsubscribe', 'manual') then raise exception 'bad reason' using errcode = '23514'; end if;
  v_hash := private.subject_hmac(v_tenant, v_mail);
  if exists (select 1 from public.email_suppressions s where s.workspace_id = p_workspace and s.email = v_mail) then return false; end if;   -- legacy row: first reason stays
  insert into public.email_suppressions (tenant_id, workspace_id, email, email_hash, reason, source, lead_id)
    values (v_tenant, p_workspace, null, v_hash, p_reason, p_source, p_lead)
    on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.suppression_add(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.suppression_add(uuid, text, text, text, uuid) to service_role;

comment on column public.email_suppressions.email_hash is 'h2: + HMAC-SHA256(tenant pepper in Vault, lower(btrim(address))). New rows keep email NULL (AUD-034).';
