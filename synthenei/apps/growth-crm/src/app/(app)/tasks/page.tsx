import { vocabFor } from "@/lib/vertical";
import { pageCtx } from "@/lib/data/context";
import { PageHeader } from "@/components/ui/misc";
import { FilterBar } from "@/components/ui/filter-bar";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { accessFor } from "@/lib/auth/roles";
import { TasksApp } from "./_components/tasks-app";
import type { TaskRow } from "./_components/shared";
import { normTasks } from "./_lib/rows";
import { fill, tt, ttAll } from "./_lib/strings";

export const metadata = { title: "Tasks" };
type SP = { kind?: string; priority?: string; owner?: string; tab?: string; week?: string };

export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { ds, now, role, session, active } = await pageCtx();
  const v = vocabFor(active.tenant), tk = v.tk, t = tt(v), strings = ttAll(v);
  const sp = await searchParams;

  // Permission-denied state: the role has no access to /tasks at all.
  if (accessFor(role, "/tasks") === null) {
    return <><PageHeader title={tk.title} sub={tk.sub} /><EmptyState title={t("deniedPageTitle")} body={t("deniedPageBody")} /></>;
  }

  // Primary source: tasks. Failure is an error state naming the source (never a blank page).
  let rawTasks: unknown[];
  try { rawTasks = await ds.tasks(); } catch {
    return <><PageHeader title={tk.title} sub={tk.sub} /><ErrorState source={t("errorSource")} message={t("errorMessage")} /></>;
  }
  // Secondary sources degrade to a partial state: tasks still show, names and filters may be incomplete.
  const [leadsR, accountsR, teamR, holidaysR] = await Promise.allSettled([ds.leads(), ds.accounts(), ds.team(), ds.holidays()]);
  const leads = leadsR.status === "fulfilled" ? leadsR.value : [];
  const accounts = accountsR.status === "fulfilled" ? accountsR.value : [];
  const team = teamR.status === "fulfilled" ? teamR.value : [];
  const holidays = holidaysR.status === "fulfilled" ? holidaysR.value : [];
  const missing = [
    leadsR.status === "rejected" || accountsR.status === "rejected" ? t("partialLeads") : null,
    teamR.status === "rejected" ? t("partialPeople") : null,
    holidaysR.status === "rejected" ? t("partialHolidays") : null,
  ].filter(Boolean) as string[];

  const KIND_OPTS = (["call", "whatsapp", "email", "demo", "follow_up", "proposal"] as const).map((k) => ({ value: k, label: tk.kind[k] }));
  const allTasks = normTasks(rawTasks);
  const team_ = role === "owner" || role === "sales_manager";
  // Owner and Sales Manager see the team's tasks; every other role sees only its own (spec 10.2: E own).
  const mine = allTasks.filter((x) => team_ || x.ownerId === session.uid);
  const filtered = mine.filter((x) => (!sp.kind || x.kind === sp.kind) && (!sp.priority || x.priority === sp.priority) && (!sp.owner || x.ownerId === sp.owner));
  const rows: TaskRow[] = filtered.map((x) => {
    const l = leads.find((y) => y.id === x.leadId);
    return {
      id: x.id, title: x.title, kind: x.kind, due: x.dueAt, priority: x.priority, ownerId: x.ownerId,
      owner: team.find((m) => m.id === x.ownerId)?.name ?? "Unassigned", version: x.version, firstResponse: x.firstResponse,
      lead: l ? { id: l.id, name: l.name, firm: accounts.find((a) => a.id === l.accountId)?.name ?? "" } : null,
    };
  });
  const people = team.filter((m) => mine.some((x) => x.ownerId === m.id) || m.role === "sales_rep");
  const myLeads = leads.filter((l) => l.stage !== "won" && l.stage !== "lost" && (team_ || l.ownerId === session.uid))
    .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200)
    .map((l) => ({ id: l.id, label: `${l.name}, ${accounts.find((a) => a.id === l.accountId)?.name ?? ""}` }));
  const filterDefs = [
    { key: "kind", label: t("type"), options: KIND_OPTS },
    { key: "priority", label: t("priority"), options: [{ value: "high", label: t("high") }, { value: "normal", label: t("normal") }, { value: "low", label: t("low") }] },
    ...(team_ ? [{ key: "owner", label: t("assignee"), options: people.map((p) => ({ value: p.id, label: p.name })) }] : []),
  ];
  const week = Math.max(-8, Math.min(8, Number(sp.week) || 0));
  const emptyHint = role === "marketing" || role === "data" ? tk.emptyMkt : sp.kind || sp.priority || sp.owner ? t("emptyFiltered") : tk.emptyDefault;
  const assignable = team.filter((m) => m.role === "sales_rep" || m.role === "sales_manager").map((m) => ({ id: m.id, name: m.name }));

  return (
    <>
      <PageHeader eyebrow={team_ ? "Team tasks" : `Your tasks · ${v.role[role]}`} title={tk.title} sub={tk.sub} />
      {missing.length > 0 && (
        <p role="status" data-testid="tasks-partial" className="mb-3 rounded-control border border-warn/50 bg-warn-soft px-3 py-2 text-[13px] text-warn-ink">
          <span className="font-medium">{t("partialTitle")}.</span> {fill(t("partialBody"), { missing: missing.join(", ") })}
        </p>
      )}
      <div className="mb-4"><FilterBar filters={filterDefs} /></div>
      <TasksApp key={JSON.stringify({ k: sp.kind, p: sp.priority, o: sp.owner })} rows={rows} now={now} weekOffset={week} holidays={holidays}
        team={assignable} leads={myLeads} defaultTab={sp.tab === "calendar" ? "calendar" : "list"} emptyHint={emptyHint} t={strings}
        canAssignOthers={role === "owner" || role === "sales_manager"} selfId={session.uid} />
    </>
  );
}
