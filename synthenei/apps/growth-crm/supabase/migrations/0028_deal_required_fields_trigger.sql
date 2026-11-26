-- 0028 (AUD-037): the database refuses a deal stage move into a stage whose required_fields are empty on the deal.
-- NOT APPLIED by the author. Idempotent (create or replace + drop trigger if exists). Additive: no data changes.
-- The app already checks the same rule before writing (pipeline/actions.ts moveDeal, db/repo/deals.ts move); this is the last line of
-- defence for any other writer (public API, SQL, imports). The check sees the NEW row, so values a Won close writes in the same UPDATE
-- (value_inr, seats, expected_close_on) count. Keys mirror REQUIRED_FIELDS.deal in src/lib/metadata/pipelines.ts:
--   value, seats  (blank = null or <= 0), expected_close, next_step (next_step text, else next_step_at), owner, custom.<key>.
-- Fires only when stage_id changes on UPDATE, so editing a deal that already sits in a stage never fails retroactively.
-- Error: errcode 23514 (the app maps it to "invalid"), message "Cannot move to <stage>: fill in <fields> first."

create or replace function metadata.deals_required_fields_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_req text[]; v_name text; v_k text; v_missing text[] := '{}'; v_label text; v_blank boolean;
begin
  if new.stage_id is null or new.stage_id is not distinct from old.stage_id then return new; end if;
  select s.required_fields, coalesce(nullif(s.name ->> 'en', ''), s.key) into v_req, v_name
    from public.pipeline_stages s where s.id = new.stage_id;
  if v_req is null or coalesce(array_length(v_req, 1), 0) = 0 then return new; end if;
  foreach v_k in array v_req loop
    v_label := v_k;
    if v_k = 'value' then v_blank := new.value_inr is null or new.value_inr <= 0; v_label := 'Value';
    elsif v_k = 'seats' then v_blank := new.seats is null or new.seats <= 0; v_label := 'Quantity';
    elsif v_k = 'expected_close' then v_blank := new.expected_close_on is null; v_label := 'Expected close date';
    elsif v_k = 'next_step' then v_blank := nullif(btrim(coalesce(new.next_step, '')), '') is null and new.next_step_at is null; v_label := 'Next step';
    elsif v_k = 'owner' then v_blank := new.owner_id is null; v_label := 'Owner';
    elsif v_k like 'custom.%' then
      v_blank := nullif(btrim(coalesce(new.custom ->> substr(v_k, 8), '')), '') is null; v_label := substr(v_k, 8);
    else
      continue; -- unknown key: never block on a field this function does not understand
    end if;
    if v_blank then v_missing := v_missing || v_label; end if;
  end loop;
  if array_length(v_missing, 1) > 0 then
    raise exception 'Cannot move to %: fill in % first.', v_name, array_to_string(v_missing, ', ') using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function metadata.deals_required_fields_guard() from public, anon, authenticated;

drop trigger if exists z9_deals_required_fields on public.deals;
create trigger z9_deals_required_fields before update of stage_id on public.deals
  for each row execute function metadata.deals_required_fields_guard();
