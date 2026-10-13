import Link from "next/link";
import { Badge, Card, Mock, PageHead, Stat, Table } from "@/components/ui";
import { consentLog, privacyRequests, staff } from "@/data/ops";
import { leads } from "@/data/leads";
import { dateOnly, dateTime, pct } from "@/lib/format";

export default function SettingsPage() {
  const coverage = leads.filter((l) => l.consent.demoFollowup).length / leads.length;
  const open = privacyRequests.filter((p) => p.status === "open");
  return (
    <>
      <PageHead title="Settings, roles, consent & privacy" sub="Who can do what, and the DPDP Act 2023 consent trail. Not legal advice; verify duties and dates with counsel." chips={<Mock />} />
      <div className="grid g-3">
        <Stat label="Consent coverage (M28)" value={pct(coverage, 0)} note="Leads with granted demo follow-up consent" />
        <Stat label="Open privacy requests (M29)" value={open.length} note={`Oldest received ${open.length ? dateOnly(open[open.length - 1].receivedOn) : "n/a"}`} />
        <Stat label="Privacy notice version" value="2026-10-v1" note="Sample; real notice text pending review" />
      </div>
      <div className="stack">
        <Card title="Users & roles" sub="admin: export, delete, integrations · marketer: edit leads and campaigns · viewer: read only">
          <Table label="Users" head={[{ t: "Name" }, { t: "Role" }, { t: "Focus" }]}>{staff.map((s) => <tr key={s.name}><td>{s.name}</td><td><Badge kind={s.role === "admin" ? "ok" : "mute"}>{s.role}</Badge></td><td>{s.focus}</td></tr>)}</Table>
        </Card>
        <Card title="Withdrawal & erasure requests" sub="Completion writes erasure_completed to consent_log, then hard-deletes the lead">
          <Table label="Privacy requests" head={[{ t: "ID" }, { t: "Type" }, { t: "Lead" }, { t: "Received" }, { t: "Due (internal)" }, { t: "Status" }]}>
            {privacyRequests.map((p) => <tr key={p.id}><td>{p.id}</td><td>{p.kind}</td><td><Link href={`/leads/${p.leadId}`}>{p.leadId}</Link></td><td>{dateOnly(p.receivedOn)}</td><td>{dateOnly(p.dueOn)}</td><td><Badge kind={p.status === "done" ? "ok" : "warn"}>{p.status}</Badge></td></tr>)}
          </Table>
        </Card>
        <Card title="Consent log" sub="Latest 15 of the sample trail (consent_log)">
          <Table label="Consent log" head={[{ t: "When" }, { t: "Lead" }, { t: "Purpose" }, { t: "Action" }, { t: "Notice" }, { t: "Captured via" }]}>
            {consentLog.slice(0, 15).map((c) => <tr key={c.id}><td>{dateTime(c.at)}</td><td>{c.leadId}</td><td>{c.purpose}</td><td><Badge kind="ok">{c.action}</Badge></td><td>{c.noticeVersion}</td><td>{c.via}</td></tr>)}
          </Table>
        </Card>
        <Card title="Retention & marketing rules (summary)">
          <ul className="list">
            <li>Keep only what the demo follow-up needs. No case parties, client names or court details in this CRM.</li>
            <li>Marketing is for the LAWSOME software, aimed at firms. Do not use client-solicitation, lead-marketplace or celebrity-endorsement angles (Bar Council Rule 36 context). Legal review pending.</li>
            <li>AI summaries are off by default and see only name, role, firm and event timeline.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
