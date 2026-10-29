-- 0018 collaboration + realtime (BUILD-PLAN 2.6, 1.5): comments with @mentions, notifications, preferences, rules, follows,
-- the activity feed view, Realtime authorization for ws:<uuid>:* topics, id-only change broadcasts, and queue_health() for /api/health.
-- Forward-only, idempotent. RLS is enabled on every new table in this file.

-- ---------- 1. Tables ----------
create table if not exists public.comments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  object_type  text not null,                       -- lead | deal | account | contact | task | campaign | conversation | obj:<key>
  object_id    uuid not null,
  parent_id    uuid references public.comments(id) on delete cascade,
  author_id    uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body         text not null check (length(body) between 1 and 10000),
  mentions     uuid[] not null default '{}' check (cardinality(mentions) <= 20),
  created_at   timestamptz not null default now(),
  edited_at    timestamptz,
  deleted_at   timestamptz
);
create index if not exists comments_object on public.comments (workspace_id, object_type, object_id, created_at);
create index if not exists comments_parent on public.comments (parent_id) where parent_id is not null;
create index if not exists comments_mentions on public.comments using gin (mentions);

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  kind         text not null check (length(kind) between 1 and 60),
  object_type  text,
  object_id    uuid,
  actor_id     uuid references public.profiles(id) on delete set null,
  title        jsonb not null default '{}',
  body         jsonb not null default '{}',
  url          text check (url is null or url ~ '^/[^/\\]'),
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists notifications_user on public.notifications (user_id, read_at, created_at desc);
create index if not exists notifications_ws on public.notifications (workspace_id, created_at desc);

create table if not exists public.notification_prefs (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind         text not null,
  channels     text[] not null default '{in_app}' check (channels <@ array['in_app', 'email', 'whatsapp', 'push']),
  digest       text not null default 'instant' check (digest in ('instant', 'hourly', 'daily', 'off')),
  primary key (user_id, workspace_id, kind)
);

create table if not exists public.notification_rules (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_type   text not null,
  conditions   jsonb not null default '{}' check (authz.valid_conditions(conditions)),
  recipients   jsonb not null default '["owner"]' check (jsonb_typeof(recipients) = 'array'),   -- owner | team_manager | role:<id> | user:<id> | followers
  channels     text[] not null default '{in_app}' check (channels <@ array['in_app', 'email', 'whatsapp', 'push']),
  template     jsonb not null default '{}',
  enabled      boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists notification_rules_ws on public.notification_rules (workspace_id, event_type);

create table if not exists public.follows (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  object_type text not null,
  object_id   uuid not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, object_type, object_id)
);

alter table public.comments           enable row level security;
alter table public.notifications      enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.notification_rules enable row level security;
alter table public.follows            enable row level security;

do $$
declare t text;
begin
  foreach t in array array['comments', 'notifications', 'notification_rules'] loop
    execute format('drop trigger if exists a00_%1$s_tenant on public.%1$I', t);
    execute format('create trigger a00_%1$s_tenant before insert or update of workspace_id, tenant_id on public.%1$I
                    for each row execute function public.set_tenant_from_workspace()', t);
  end loop;
end $$;

-- ---------- 2. Can another user read an object? (mention check; mirrors authz.explain for a given user) ----------
create or replace function authz.team_user_ids_for(p_user uuid, p_ws uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with recursive mine as (
    select tm.team_id, tm.is_manager from public.team_members tm join public.teams t on t.id = tm.team_id
     where tm.user_id = p_user and t.workspace_id = p_ws),
  down(team_id) as (
    select team_id from mine where is_manager
    union
    select t.id from public.teams t join down d on t.parent_team_id = d.team_id where t.workspace_id = p_ws)
  select p_user
  union select tm.user_id from public.team_members tm where tm.team_id in (select team_id from mine)
  union select tm.user_id from public.team_members tm where tm.team_id in (select team_id from down)
$$;

create or replace function authz.user_can_read(p_user uuid, p_ws uuid, p_type text, p_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_row jsonb; v_perm text := authz.object_perm(p_type, 'read'); v_scope text; v_owner uuid; v_asg uuid; v_role uuid;
begin
  v_row := authz.object_row(p_type, p_id);
  if v_row is null or (v_row ->> 'workspace_id')::uuid is distinct from p_ws then return false; end if;
  select m.role_id into v_role from public.memberships m
   where m.user_id = p_user and m.workspace_id = p_ws and m.is_active and (m.valid_until is null or m.valid_until > now());
  if v_role is null then return false; end if;
  v_owner := nullif(v_row ->> 'owner_id', '')::uuid; v_asg := nullif(v_row ->> 'assignee_id', '')::uuid;
  if p_type ~ '^obj:' then
    select rp.scope into v_scope from public.role_permissions rp where rp.role_id = v_role and rp.permission_key = v_perm;
  else
    select rp.scope into v_scope from public.role_permissions rp where rp.role_id = v_role and rp.permission_key = v_perm;
  end if;
  if coalesce(v_scope, 'none') <> 'none' and (
       v_scope = 'all'
    or (v_scope = 'team' and (v_owner in (select authz.team_user_ids_for(p_user, p_ws)) or v_asg in (select authz.team_user_ids_for(p_user, p_ws))))
    or (v_scope in ('own', 'team') and (v_owner = p_user or v_asg = p_user))) then
    return true;
  end if;
  return exists (select 1 from public.relationship_tuples rt
                  where rt.workspace_id = p_ws and rt.object_type = p_type and rt.object_id = p_id and (rt.expires_at is null or rt.expires_at > now())
                    and ((rt.subject_type = 'user' and rt.subject_id = p_user)
                      or (rt.subject_type = 'role' and rt.subject_id = v_role)
                      or (rt.subject_type = 'team' and rt.subject_id in (select tm.team_id from public.team_members tm where tm.user_id = p_user))));
end $$;
revoke all on function authz.team_user_ids_for(uuid, uuid), authz.user_can_read(uuid, uuid, text, uuid) from public, anon;
grant execute on function authz.team_user_ids_for(uuid, uuid), authz.user_can_read(uuid, uuid, text, uuid) to service_role;

-- ---------- 3. Comment triggers ----------
-- before write: same-object replies, mentioned users must be able to read the record, authors may only touch body/mentions
create or replace function public.comments_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_u uuid; v_parent public.comments;
begin
  if tg_op = 'INSERT' then
    if new.parent_id is not null then
      select * into v_parent from public.comments c where c.id = new.parent_id;
      if v_parent.id is null or v_parent.object_type <> new.object_type or v_parent.object_id <> new.object_id then
        raise exception 'reply must belong to the same record' using errcode = '23514';
      end if;
    end if;
  else
    if (new.tenant_id, new.workspace_id, new.object_type, new.object_id, new.parent_id, new.author_id, new.created_at)
       is distinct from (old.tenant_id, old.workspace_id, old.object_type, old.object_id, old.parent_id, old.author_id, old.created_at) then
      raise exception 'only body and mentions can be edited' using errcode = '23514';
    end if;
    if new.body is distinct from old.body or new.mentions is distinct from old.mentions then new.edited_at := now(); end if;
  end if;
  if tg_op = 'INSERT' or new.mentions is distinct from old.mentions then
    foreach v_u in array new.mentions loop
      if v_u = new.author_id then continue; end if;
      if not authz.user_can_read(v_u, new.workspace_id, new.object_type, new.object_id) then
        raise exception 'mention_not_allowed: user % cannot read this record', v_u using errcode = '42501';
      end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists a30_comments_guard on public.comments;
create trigger a30_comments_guard before insert or update on public.comments for each row execute function public.comments_guard();

-- after insert: event, follow the record, notify mentioned users and followers
create or replace function public.comments_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_u uuid; v_title jsonb := jsonb_build_object('en', 'New comment'); v_url text;
begin
  perform events._insert(new.tenant_id, new.workspace_id, 'comment.created', 'comment', new.id,
                         jsonb_build_object('on_type', new.object_type, 'on_id', new.object_id, 'mentions', to_jsonb(new.mentions)));
  insert into public.follows (user_id, object_type, object_id) values (new.author_id, new.object_type, new.object_id) on conflict do nothing;
  foreach v_u in array new.mentions loop
    if v_u <> new.author_id then
      insert into public.follows (user_id, object_type, object_id) values (v_u, new.object_type, new.object_id) on conflict do nothing;
      insert into public.notifications (tenant_id, workspace_id, user_id, kind, object_type, object_id, actor_id, title, body)
      values (new.tenant_id, new.workspace_id, v_u, 'mention', new.object_type, new.object_id, new.author_id,
              jsonb_build_object('en', 'You were mentioned'), jsonb_build_object('en', left(new.body, 140)));
      perform events._insert(new.tenant_id, new.workspace_id, 'mention.created', 'comment', new.id,
                             jsonb_build_object('user_id', v_u));
    end if;
  end loop;
  insert into public.notifications (tenant_id, workspace_id, user_id, kind, object_type, object_id, actor_id, title, body)
  select new.tenant_id, new.workspace_id, f.user_id, 'comment', new.object_type, new.object_id, new.author_id,
         v_title, jsonb_build_object('en', left(new.body, 140))
    from public.follows f
   where f.object_type = new.object_type and f.object_id = new.object_id and f.user_id <> new.author_id
     and not (f.user_id = any (new.mentions))
     and exists (select 1 from public.memberships m where m.user_id = f.user_id and m.workspace_id = new.workspace_id and m.is_active)
     and authz.user_can_read(f.user_id, new.workspace_id, new.object_type, new.object_id);
  return null;
end $$;
drop trigger if exists trg_comments_after_insert on public.comments;
create trigger trg_comments_after_insert after insert on public.comments for each row execute function public.comments_after_insert();

-- ---------- 4. RLS ----------
do $$ begin
  -- comments: readable iff the commented record is readable; author edits own comment within 15 minutes; moderators remove
  perform private.rls_put('comments', 'select',
    $p$deleted_at is null and workspace_id in (select public.member_ws_ids())
       and authz.check(workspace_id, authz.object_perm(object_type, 'read'), object_type, object_id)$p$, null);
  perform private.rls_put('comments', 'insert', null,
    $p$author_id = (select auth.uid()) and workspace_id in (select authz.ws_with('comments.write', 'own'))
       and authz.check(workspace_id, authz.object_perm(object_type, 'read'), object_type, object_id)$p$);
  perform private.rls_put('comments', 'update',
    $p$workspace_id in (select public.member_ws_ids())
       and ((author_id = (select auth.uid()) and deleted_at is null and created_at > now() - interval '15 minutes')
            or workspace_id in (select authz.ws_with('comments.moderate', 'all')))$p$,
    $p$workspace_id in (select public.member_ws_ids())
       and ((author_id = (select auth.uid()) and deleted_at is null)
            or workspace_id in (select authz.ws_with('comments.moderate', 'all')))$p$);
  perform private.rls_put('comments', 'delete', $p$workspace_id in (select authz.ws_with('comments.moderate', 'all'))$p$, null);

  perform private.rls_put('notifications', 'select', 'user_id = (select auth.uid())', null);
  perform private.rls_put('notifications', 'update', 'user_id = (select auth.uid())', 'user_id = (select auth.uid())');
  perform private.rls_put('notifications', 'delete', 'user_id = (select auth.uid())', null);

  perform private.rls_put('notification_prefs', 'select', 'user_id = (select auth.uid())', null);
  perform private.rls_put('notification_prefs', 'insert', null,
    'user_id = (select auth.uid()) and workspace_id in (select public.member_ws_ids())');
  perform private.rls_put('notification_prefs', 'update', 'user_id = (select auth.uid())',
    'user_id = (select auth.uid()) and workspace_id in (select public.member_ws_ids())');
  perform private.rls_put('notification_prefs', 'delete', 'user_id = (select auth.uid())', null);

  perform private.rls_put('notification_rules', 'select', $p$workspace_id in (select authz.ws_with('notifications.manage', 'all'))$p$, null);
  perform private.rls_put('notification_rules', 'insert', null, $p$workspace_id in (select authz.ws_with_member('notifications.manage', 'all'))$p$);
  perform private.rls_put('notification_rules', 'update', $p$workspace_id in (select authz.ws_with_member('notifications.manage', 'all'))$p$,
                          $p$workspace_id in (select authz.ws_with_member('notifications.manage', 'all'))$p$);
  perform private.rls_put('notification_rules', 'delete', $p$workspace_id in (select authz.ws_with_member('notifications.manage', 'all'))$p$, null);

  perform private.rls_put('follows', 'select', 'user_id = (select auth.uid())', null);
  perform private.rls_put('follows', 'insert', null, 'user_id = (select auth.uid())');
  perform private.rls_put('follows', 'delete', 'user_id = (select auth.uid())', null);
end $$;

revoke all on public.comments, public.notifications, public.notification_prefs, public.notification_rules, public.follows from anon;
grant select, insert, update, delete on public.comments, public.notification_prefs, public.notification_rules, public.follows to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;     -- everything else is written by triggers / the notifier (service role)
grant all on public.comments, public.notifications, public.notification_prefs, public.notification_rules, public.follows to service_role;
revoke update on public.comments from authenticated;
grant update (body, mentions, deleted_at) on public.comments to authenticated;

-- ---------- 5. Activity feed: events on records the caller can read ----------
-- events_select (0014) lets events.read holders see everything; this second permissive policy lets anyone read the events of
-- records they can read. PII object types additionally need pii.read.
drop policy if exists events_select_readable on public.events;
create policy events_select_readable on public.events for select to authenticated using (
  object_type is not null and object_id is not null
  and workspace_id in (select public.member_ws_ids())
  and (object_type not in ('lead', 'contact', 'conversation') or workspace_id in (select authz.ws_with('pii.read', 'own')))
  and authz.check(workspace_id, authz.object_perm(object_type, 'read'), object_type, object_id));

create or replace view public.v_activity_feed with (security_invoker = true) as
select e.id, e.occurred_at, e.workspace_id, e.type, e.object_type, e.object_id, e.actor_kind, e.actor_id, e.data
  from public.events e
 where e.object_type is not null;
revoke all on public.v_activity_feed from anon;
grant select on public.v_activity_feed to authenticated;

-- ---------- 6. Realtime ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- Private channels ws:<workspace uuid>:...  Only members of that workspace (support sessions included) may receive and send.
do $$
declare v_expr constant text := $e$(extension in ('broadcast', 'presence')
  and realtime.topic() ~ '^ws:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:'
  and (case when realtime.topic() ~ '^ws:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:'
            then split_part(realtime.topic(), ':', 2)::uuid end) in (select public.member_ws_ids()))$e$;
begin
  if to_regclass('realtime.messages') is null then
    raise notice '0018: realtime.messages not present, skipping realtime policies';
    return;
  end if;
  execute 'drop policy if exists realtime_ws_members_select on realtime.messages';
  execute 'drop policy if exists realtime_ws_members_insert on realtime.messages';
  execute format('create policy realtime_ws_members_select on realtime.messages for select to authenticated using %s', v_expr);
  execute format('create policy realtime_ws_members_insert on realtime.messages for insert to authenticated with check %s', v_expr);
end $$;

-- Row-change broadcast: id-only payload {id, op, version, changed_by, changed_fields[]} on ws:<ws>:tbl:<table>. Clients refetch through RLS.
-- (realtime.broadcast_changes would ship the whole row, so realtime.send is used.) Never blocks the business write.
create or replace function public.realtime_broadcast_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_new jsonb; v_old jsonb; v_row jsonb; v_ws uuid; v_fields jsonb := '[]'::jsonb;
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then return null; end if;
  v_new := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row := coalesce(v_new, v_old);
  v_ws := nullif(v_row ->> 'workspace_id', '')::uuid;
  if v_ws is null then return null; end if;
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_agg(k.key), '[]'::jsonb) into v_fields
      from (select n.key from jsonb_each(v_new) n where n.value is distinct from v_old -> n.key and n.key not in ('updated_at', 'version') limit 30) k;
  end if;
  perform realtime.send(jsonb_build_object('id', v_row ->> 'id', 'op', tg_op, 'version', v_row -> 'version',
                                           'changed_by', (select auth.uid()), 'changed_fields', v_fields),
                        tg_op, 'ws:' || v_ws || ':tbl:' || tg_table_name, true);
  return null;
exception when others then
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['leads', 'contacts', 'accounts', 'deals', 'tasks', 'campaigns', 'conversations', 'messages', 'activities',
                           'pipeline_stages', 'comments', 'records'] loop
    execute format('drop trigger if exists z7_%1$s_rt on public.%1$I', t);
    execute format('create trigger z7_%1$s_rt after insert or update or delete on public.%1$I
                    for each row execute function public.realtime_broadcast_row()', t);
  end loop;
end $$;

-- ---------- 7. Queue health for /api/health (service role) ----------
-- {oldest_age_s: {<queue>: seconds of the oldest waiting message}, depth: {<queue>: n}, failed_1h: failed/dead job runs in the last hour}
create or replace function public.queue_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_age jsonb; v_depth jsonb;
begin
  select coalesce(jsonb_object_agg(m.queue_name, coalesce(m.oldest_msg_age_sec, 0)), '{}'::jsonb),
         coalesce(jsonb_object_agg(m.queue_name, m.queue_length), '{}'::jsonb)
    into v_age, v_depth from pgmq.metrics_all() m;
  return jsonb_build_object('oldest_age_s', v_age, 'depth', v_depth,
    'failed_1h', (select count(*) from public.job_runs j where j.status in ('failed', 'dead') and j.started_at > now() - interval '1 hour'));
end $$;
revoke all on function public.queue_health() from public, anon, authenticated;
grant execute on function public.queue_health() to service_role;

-- ---------- 8. Self-check ----------
do $$
begin
  assert (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname in ('comments', 'notifications', 'notification_prefs', 'notification_rules', 'follows')
             and c.relrowsecurity) = 5, '0018: RLS missing on a new table';
end $$;
