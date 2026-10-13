import Link from "next/link";
import { Badge, Card, Mock, PageHead, Stat, Table } from "@/components/ui";
import { tasks, SLA_MINUTES } from "@/data/ops";
import { leadById, NOW_ISO, leads } from "@/data/leads";
import { dateTime, dur, pct } from "@/lib/format";
import { slaStats } from "@/lib/metrics";

export default function TasksPage() {
  const now = new Date(NOW_ISO).getTime();
  const open = tasks.filter((t) => t.status === "open");
  const overdue = open.filter((t) => new Date(t.dueAt).getTime() < now);
  const sla = slaStats();
  const group = (title: string, items: typeof tasks) => (
    <Card title={`${title} (${items.length})`}>
      {items.length === 0 ? <p className="muted">Nothing here.</p> : (
        <Table label={title} head={[{ t: "Task" }, { t: "Lead" }, { t: "Assignee" }, { t: "Due" }, { t: "Type" }]}>
          {items.map((t) => { const l = leadById(t.leadId); return <tr key={t.id}><td>{t.title}</td><td><Link href={`/leads/${t.leadId}`}>{l?.name}</Link></td><td>{t.assignee}</td><td>{dateTime(t.dueAt)}</td><td><Badge kind="mute">{t.kind}</Badge></td></tr>; })}
        </Table>
      )}
    </Card>
  );
  const today = open.filter((t) => { const d = new Date(t.dueAt).getTime(); return d >= now && d < now + 24 * 3600e3; });
  const upcoming = open.filter((t) => new Date(t.dueAt).getTime() >= now + 24 * 3600e3);
  return (
    <>
      <PageHead title="Tasks & follow-ups" sub={`First-response SLA: ${SLA_MINUTES / 60} hours from form submit (mock uses wall-clock hours; real rule should use business hours).`} chips={<Mock />} />
      <div className="grid g-4">
        <Stat label="Open tasks" value={open.length} />
        <Stat label="Overdue" value={overdue.length} note="Due before now" />
        <Stat label="Median first response (M14)" value={dur(sla.median)} />
        <Stat label="Within SLA" value={pct(sla.pctWithin, 0)} note={`${sla.breached} of ${leads.length} breached or waiting too long`} />
      </div>
      <div className="stack">{group("Overdue", overdue)}{group("Next 24 hours", today)}{group("Later", upcoming)}</div>
    </>
  );
}
