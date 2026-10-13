-- Spread the synthetic demo rows across the real people of each demo workspace (run after users have
-- accepted their invitations; re-runnable). Run as postgres/service role. Updates only is_synthetic rows.
--   leads      -> sales_rep members, by district (round-robin over the workspace's reps)
--   deals, tasks, activities, conversations -> the owner of their lead
--   campaigns  -> first marketing member (else the workspace owner)
--   territories -> each district the rep received
begin;
select set_config('app.actor_label', 'seed', true);

with reps as (
  select m.workspace_id, m.user_id, row_number() over (partition by m.workspace_id order by m.created_at, m.user_id) - 1 as k,
         count(*) over (partition by m.workspace_id) as n
    from public.memberships m
   where m.role = 'sales_rep' and m.is_active
), districts as (
  select l.workspace_id, l.district,
         dense_rank() over (partition by l.workspace_id order by l.district) - 1 as d
    from public.leads l where l.is_synthetic and l.district is not null
   group by l.workspace_id, l.district
)
update public.leads l
   set owner_id = r.user_id, assigned_at = coalesce(l.assigned_at, l.created_at)
  from districts d join reps r on r.workspace_id = d.workspace_id and r.k = d.d % r.n
 where l.is_synthetic and l.workspace_id = d.workspace_id and l.district = d.district and l.status <> 'new';

insert into public.territories (workspace_id, district, rep_id)
select distinct on (l.workspace_id, l.district) l.workspace_id, l.district, l.owner_id
  from public.leads l where l.is_synthetic and l.owner_id is not null and l.district is not null
 order by l.workspace_id, l.district, l.created_at
on conflict (workspace_id, district) do update set rep_id = excluded.rep_id;

update public.deals d set owner_id = l.owner_id from public.leads l where d.lead_id = l.id and d.is_synthetic;
update public.tasks t set assignee_id = l.owner_id from public.leads l where t.lead_id = l.id and l.is_synthetic;
update public.activities a set owner_id = l.owner_id from public.leads l where a.lead_id = l.id and l.is_synthetic;
update public.conversations c set assignee_id = l.owner_id from public.leads l where c.lead_id = l.id and l.is_synthetic;
update public.campaigns c
   set owner_id = coalesce(
         (select m.user_id from public.memberships m where m.workspace_id = c.workspace_id and m.role = 'marketing' and m.is_active order by m.created_at limit 1),
         (select m.user_id from public.memberships m where m.workspace_id = c.workspace_id and m.role = 'owner' and m.is_active order by m.created_at limit 1))
 where c.is_synthetic;
commit;
