-- 0022c (T041): T032 items skipped at gate 4. Additive; nothing here can fail on existing rows or touch existing data.
--  1. (pipeline_id, position) unique becomes DEFERRABLE INITIALLY DEFERRED (same name, same columns, so an in-transaction reorder is legal).
--  2. pipeline_stages.color check (NOT VALID: existing rows are not re-checked; all 39 are null today).
--  3. Stage guards: deals and leads may not be moved INTO an archived stage; a stage cannot be archived while live deals or leads sit in it.
--  4. public.save_pipeline_stages(p_pipeline, p_stages): the whole stage list in one transaction, SECURITY INVOKER (RLS: pipelines.manage).
-- NOT done on purpose: DB enforcement of stage required_fields (the app's rule depends on values supplied with the move, see docs/gates/advisors.md).

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'pipeline_stages_pipeline_position' and conrelid = 'public.pipeline_stages'::regclass and not condeferrable) then
    alter table public.pipeline_stages drop constraint pipeline_stages_pipeline_position;
    alter table public.pipeline_stages add constraint pipeline_stages_pipeline_position unique (pipeline_id, "position") deferrable initially deferred;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pipeline_stages_color_check' and conrelid = 'public.pipeline_stages'::regclass) then
    alter table public.pipeline_stages add constraint pipeline_stages_color_check
      check (color is null or color in ('neutral', 'accent', 'info', 'warn', 'success', 'danger')) not valid;
  end if;
end $$;

create or replace function metadata.stage_live_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_arch timestamptz;
begin
  if new.stage_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then return new; end if;
  select s.archived_at into v_arch from public.pipeline_stages s where s.id = new.stage_id;
  if v_arch is not null then
    raise exception 'stage is archived' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function metadata.stage_live_guard() from public, anon, authenticated;

create or replace function metadata.stage_archive_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.archived_at is null and new.archived_at is not null then
    if exists (select 1 from public.deals d where d.stage_id = new.id and d.deleted_at is null)
       or exists (select 1 from public.leads l where l.stage_id = new.id and l.deleted_at is null) then
      raise exception 'stage still has records' using errcode = '23503';
    end if;
  end if;
  return new;
end $$;
revoke all on function metadata.stage_archive_guard() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'z8a_deals_stage_live' and tgrelid = 'public.deals'::regclass) then
    create trigger z8a_deals_stage_live before insert or update of stage_id on public.deals for each row execute function metadata.stage_live_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'z8a_leads_stage_live' and tgrelid = 'public.leads'::regclass) then
    create trigger z8a_leads_stage_live before insert or update of stage_id on public.leads for each row execute function metadata.stage_live_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'a90_pipeline_stages_archive' and tgrelid = 'public.pipeline_stages'::regclass) then
    create trigger a90_pipeline_stages_archive before update of archived_at on public.pipeline_stages for each row execute function metadata.stage_archive_guard();
  end if;
end $$;

-- p_stages: jsonb array of {id?, key, name:{en,...}, position, probability, color, outcome, sla_hours, required_fields[], archived, expected_version?}.
-- With id: updates that stage (expected_version, when given, must equal the stored version, else SQLSTATE 40001). Without id: inserts (key required).
-- Returns the saved stage rows as jsonb. Nothing is deleted.
create or replace function public.save_pipeline_stages(p_pipeline uuid, p_stages jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_p public.pipelines; s jsonb; v_id uuid; v_cur public.pipeline_stages; v_name jsonb; v_out text; v_arch boolean;
  v_ids uuid[] := '{}'; v_req text[];
begin
  select * into v_p from public.pipelines where id = p_pipeline;
  if v_p.id is null then raise exception 'pipeline not found' using errcode = 'P0002'; end if;
  if p_stages is null or jsonb_typeof(p_stages) <> 'array' then raise exception 'p_stages must be an array' using errcode = '22023'; end if;
  for s in select * from jsonb_array_elements(p_stages) loop
    v_id := nullif(s->>'id', '')::uuid;
    v_name := coalesce(s->'name', jsonb_build_object('en', coalesce(s->>'label', s->>'key')));
    v_out := coalesce(s->>'outcome', 'open');
    v_arch := coalesce((s->>'archived')::boolean, false);
    v_req := case when jsonb_typeof(s->'required_fields') = 'array' then array(select jsonb_array_elements_text(s->'required_fields')) else null end;
    if v_id is not null then
      select * into v_cur from public.pipeline_stages where id = v_id and pipeline_id = p_pipeline for update;
      if v_cur.id is null then raise exception 'stage % not in pipeline', v_id using errcode = 'P0002'; end if;
      if s ? 'expected_version' and (s->>'expected_version')::int <> v_cur.version then
        raise exception 'stage % changed (version conflict)', v_id using errcode = '40001';
      end if;
      update public.pipeline_stages set
        name = v_name, label = coalesce(v_name->>'en', v_cur.label),
        position = coalesce((s->>'position')::smallint, v_cur.position),
        probability = coalesce((s->>'probability')::smallint, v_cur.probability),
        color = case when s ? 'color' then nullif(s->>'color', '') else v_cur.color end,
        outcome = v_out,
        sla_hours = case when s ? 'sla_hours' then (s->>'sla_hours')::int else v_cur.sla_hours end,
        required_fields = coalesce(v_req, v_cur.required_fields),
        archived_at = case when v_arch then coalesce(v_cur.archived_at, now()) else null end
       where id = v_id;
    else
      if coalesce(s->>'key', '') = '' then raise exception 'stage key required' using errcode = '22023'; end if;
      insert into public.pipeline_stages (tenant_id, workspace_id, pipeline_id, key, label, name, position, probability, color, outcome, sla_hours, required_fields, archived_at)
      values (v_p.tenant_id, v_p.workspace_id, p_pipeline, s->>'key', coalesce(v_name->>'en', s->>'key'), v_name,
              coalesce((s->>'position')::smallint, 0), coalesce((s->>'probability')::smallint, 0), nullif(s->>'color', ''), v_out,
              (s->>'sla_hours')::int, coalesce(v_req, '{}'), case when v_arch then now() end)
      returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.position) from public.pipeline_stages x where x.id = any(v_ids)), '[]'::jsonb);
end $$;
revoke all on function public.save_pipeline_stages(uuid, jsonb) from public, anon;
grant execute on function public.save_pipeline_stages(uuid, jsonb) to authenticated;
