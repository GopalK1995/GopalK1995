-- 0031 consent_hmac_backfill (AUD-034). Phase 2 of 2: rehash rows written before 0030. NOT applied by the agent that wrote it.
-- Apply only AFTER 0030 AND after the app version that calls suppression_check / suppression_add is deployed (otherwise a running
-- old build would keep looking suppressions up by clear text and miss the rehashed rows: it would MAIL SUPPRESSED ADDRESSES).
--
--   1. email_suppressions: legacy clear-text rows get email_hash and then email = NULL. The clear-text address is gone afterwards.
--   2. consent_log: rows whose subject_ref is still the plain sha256 (no prefix) become 'h2:' + HMAC(tenant pepper, that sha256).
--      consent_log is append-only by design (0026), so the guard trigger is switched off for this one transaction only and is
--      switched back on at the end; the migration aborts if it cannot be.
--      'h1:' rows (one global secret) cannot be converted: their plain sha256 is not recoverable from the HMAC. They stay matched by
--      consent_ref_variants() for as long as the secret consent_subject_salt exists. Do NOT delete that secret.
--
-- Pre-check (read-only):  select count(*) from public.email_suppressions where email is not null;
--                         select count(*) from public.consent_log where subject_ref ~ '^[a-f0-9]{32,128}$';
-- Post-check:             both counts above are 0; select count(*) from public.email_suppressions where email_hash is null; is 0.
--
-- ROLLBACK: NOT reversible for the clear-text addresses (that is the point). Before applying, take a backup if the old values must
-- be recoverable: create table private.email_suppressions_pre0031 as select * from public.email_suppressions; (contains clear text:
-- drop it as soon as the post-check passes). consent_log: the plain sha256 cannot be restored either; restoring needs a backup.
-- Idempotent: a second run finds nothing left to do.

do $$
declare v_ok boolean;
begin
  if to_regprocedure('private.subject_hmac(uuid,text)') is null then raise exception '0030_consent_hmac_pepper must be applied first'; end if;

  -- 1. suppressions
  delete from public.email_suppressions s
   where s.email is not null and s.email_hash is null
     and exists (select 1 from public.email_suppressions h where h.workspace_id = s.workspace_id and h.email_hash = private.subject_hmac(s.tenant_id, lower(btrim(s.email))));
  update public.email_suppressions
     set email_hash = private.subject_hmac(tenant_id, lower(btrim(email))), email = null
   where email is not null and email_hash is null;

  -- 2. consent_log (append-only guard off for this transaction only)
  alter table public.consent_log disable trigger consent_log_append_only;
  update public.consent_log c
     set subject_ref = private.subject_hmac(c.tenant_id, c.subject_ref)
   where c.subject_ref ~ '^[a-f0-9]{32,128}$';
  alter table public.consent_log enable trigger consent_log_append_only;

  select tgenabled = 'O' into v_ok from pg_trigger where tgname = 'consent_log_append_only' and tgrelid = 'public.consent_log'::regclass;
  if not coalesce(v_ok, false) then raise exception 'consent_log append-only trigger is not enabled: aborting'; end if;
end $$;
