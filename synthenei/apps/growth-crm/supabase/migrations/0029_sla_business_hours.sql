-- 0029 first-response SLA inside business hours + one open first-response task per lead (AUD-025: BE-017, DATA-015). NOT APPLIED.
-- Idempotent: safe to run twice. The app's TypeScript clock (src/lib/sla/business-hours.ts) works with or without this migration.
--  * public.business_due_at(): due instant after p_mins business minutes, using workspace days/start/end/timezone/holidays.
--  * public.lead_first_response_task(): due_at now uses business hours (falls back to wall clock if the hours are unusable) and a
--    reassignment MOVES the single open first-response task to the new owner instead of adding a second one.
--  * Existing duplicate open first-response tasks are cancelled (newest kept), then a partial unique index enforces one per lead.

create or replace function public.business_due_at(
  p_from timestamptz, p_mins int, p_tz text, p_days int[], p_start time, p_end time, p_holidays date[]
) returns timestamptz
language plpgsql stable set search_path = '' as $$
declare
  tz text := coalesce(nullif(p_tz, ''), 'Asia/Kolkata');
  left_mins numeric := greatest(coalesce(p_mins, 0), 0);
  local_day date;
  win_open timestamptz; win_close timestamptz; seg_start timestamptz; room numeric;
  i int;
begin
  if p_from is null or p_start is null or p_end is null or p_start >= p_end
     or p_days is null or cardinality(p_days) = 0 then
    return p_from + make_interval(mins => greatest(coalesce(p_mins, 0), 0));  -- unusable hours: honest wall-clock fallback
  end if;
  local_day := (p_from at time zone tz)::date;
  for i in 0..399 loop
    if extract(dow from local_day)::int = any (p_days) and not (local_day = any (coalesce(p_holidays, '{}'::date[]))) then
      win_open  := (local_day + p_start) at time zone tz;
      win_close := (local_day + p_end)   at time zone tz;
      if win_close > p_from then
        seg_start := greatest(win_open, p_from);
        room := extract(epoch from (win_close - seg_start)) / 60.0;
        if left_mins <= room then
          return seg_start + make_interval(secs => left_mins * 60.0);
        end if;
        left_mins := left_mins - room;
      end if;
    end if;
    local_day := local_day + 1;
  end loop;
  return p_from + make_interval(mins => greatest(coalesce(p_mins, 0), 0));  -- no window within 400 days
end $$;

-- 1. Cancel older duplicate open first-response tasks (keep the newest per lead).
update public.tasks t set status = 'cancelled'
 where t.kind = 'first_response' and t.status = 'open' and t.lead_id is not null
   and exists (select 1 from public.tasks n
                where n.lead_id = t.lead_id and n.kind = 'first_response' and n.status = 'open'
                  and (n.created_at, n.id) > (t.created_at, t.id));

-- 2. One open first-response task per lead, enforced.
create unique index if not exists tasks_one_open_first_response
  on public.tasks (lead_id) where kind = 'first_response' and status = 'open';

-- 3. Trigger function.
create or replace function public.lead_first_response_task() returns trigger
language plpgsql security definer set search_path = '' as $$
declare w public.workspaces%rowtype; bh jsonb; due timestamptz; moved int;
begin
  if new.owner_id is not null and new.first_response_at is null
     and (tg_op = 'INSERT' or old.owner_id is distinct from new.owner_id) then
    if tg_op = 'UPDATE' then new.assigned_at := now(); end if;

    -- Reassignment: move the existing open task to the new owner; the clock keeps running from lead creation.
    if tg_op = 'UPDATE' then
      update public.tasks set assignee_id = new.owner_id, updated_at = now()
       where lead_id = new.id and workspace_id = new.workspace_id and kind = 'first_response' and status = 'open';
      get diagnostics moved = row_count;
      if moved > 0 then return new; end if;
    end if;

    select * into w from public.workspaces where id = new.workspace_id;
    bh := coalesce(w.business_hours, '{"days":[1,2,3,4,5,6],"start":"10:00","end":"19:00"}'::jsonb);
    due := public.business_due_at(
      coalesce(new.created_at, now()), coalesce(w.sla_first_response_mins, 120), w.timezone,
      array(select (jsonb_array_elements_text(bh -> 'days'))::int),
      (bh ->> 'start')::time, (bh ->> 'end')::time, w.holidays);
    -- A lead created long ago and only now assigned must not get a due date in the past.
    due := greatest(due, public.business_due_at(now(), 0, w.timezone,
      array(select (jsonb_array_elements_text(bh -> 'days'))::int), (bh ->> 'start')::time, (bh ->> 'end')::time, w.holidays));

    insert into public.tasks (workspace_id, lead_id, title, kind, priority, assignee_id, due_at)
    values (new.workspace_id, new.id, 'First response: ' || new.full_name, 'first_response', 1, new.owner_id, due)
    on conflict (lead_id) where kind = 'first_response' and status = 'open' do nothing;
  end if;
  return new;
end $$;
