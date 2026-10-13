import { pageCtx } from "@/lib/data/context";
import { PageHeader } from "@/components/ui/misc";
import { FilterBar } from "@/components/ui/filter-bar";
import { ROLE_LABEL } from "@/lib/auth/roles";
import type { Task } from "@/lib/data/types";
import { TasksApp } from "./_components/tasks-app";
import type { TaskRow } from "./_components/shared";

export const metadata = { title: "Tasks" };
type SP = { kind?: string; priority?: string; owner?: string; tab?: string; week?: string };
const KIND_OPTS: { value: Task["kind"]; label: string }[] = [
  { value: "call", label: "Call" }, { value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" },
  { value: "demo", label: "Demo" }, { value: "follow_up", label: "Follow-up" }, { value: "proposal", label: "Proposal" },
];

export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { ds, now, role, session } = await pageCtx();
  const sp = await searchParams;
  const [allTasks, leads, accounts, team, holidays] = await Promise.all([ds.tasks(), ds.leads(), ds.accounts(), ds.team(), ds.holidays()]);
  const team_ = role === "owner" || role === "sales_manager";
  // Owner and Sales Manager see the team's tasks; every other role sees only its own (spec 10.2: E own).
  const mine = allTasks.filter((t) => t.status === "open" && (team_ || t.ownerId === session.uid));
  const filtered = mine.filter((t) => (!sp.kind || t.kind === sp.kind) && (!sp.priority || t.priority === sp.priority) && (!sp.owner || t.ownerId === sp.owner));
  const rows: TaskRow[] = filtered.map((t) => {
    const l = leads.find((x) => x.id === t.leadId);
    return {
      id: t.id, title: t.title, kind: t.kind, due: t.dueAt, priority: t.priority, ownerId: t.ownerId,
      owner: team.find((m) => m.id === t.ownerId)?.name ?? "Unassigned",
      lead: l ? { id: l.id, name: l.name, firm: accounts.find((a) => a.id === l.accountId)?.name ?? "" } : null,
    };
  });
  const people = team.filter((m) => mine.some((t) => t.ownerId === m.id) || m.role === "sales_rep");
  const myLeads = leads.filter((l) => l.stage !== "won" && l.stage !== "lost" && (team_ || l.ownerId === session.uid))
    .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200)
    .map((l) => ({ id: l.id, label: `${l.name}, ${accounts.find((a) => a.id === l.accountId)?.name ?? ""}` }));
  const filters = [
    { key: "kind", label: "Type", options: KIND_OPTS },
    { key: "priority", label: "Priority", options: [{ value: "high", label: "High" }, { value: "normal", label: "Normal" }, { value: "low", label: "Low" }] },
    ...(team_ ? [{ key: "owner", label: "Assignee", options: people.map((p) => ({ value: p.id, label: p.name })) }] : []),
  ];
  const week = Math.max(-8, Math.min(8, Number(sp.week) || 0));
  const emptyHint = role === "marketing" || role === "data"
    ? `No tasks assigned to you. Tasks you create here (for example "Re-import Coimbatore Bar list") stay visible only to you and your Owner.`
    : sp.kind || sp.priority || sp.owner ? "No open tasks match these filters. Clear a filter to see the rest." : "No open tasks. Logging a call with a next-step date creates one.";

  return (
    <>
      <PageHeader eyebrow={team_ ? "Team tasks" : `Your tasks · ${ROLE_LABEL[role]}`} title="Tasks and demo calendar"
        sub="Follow-ups and demos in IST. Overdue first; court hours (10:30–17:00) are the hardest time to reach partners." />
      <div className="mb-4"><FilterBar filters={filters} /></div>
      <TasksApp key={JSON.stringify({ k: sp.kind, p: sp.priority, o: sp.owner })} rows={rows} now={now} weekOffset={week} holidays={holidays}
        team={team.filter((m) => m.role === "sales_rep" || m.role === "sales_manager").map((m) => ({ id: m.id, name: m.name }))}
        leads={myLeads} defaultTab={sp.tab === "calendar" ? "calendar" : "list"} emptyHint={emptyHint} />
    </>
  );
}
