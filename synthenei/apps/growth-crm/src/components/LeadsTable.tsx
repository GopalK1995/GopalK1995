"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Lead } from "@/data/types";
import { Table, Badge } from "./ui";
import { dateOnly, stageLabel } from "@/lib/format";

export default function LeadsTable({ leads, campaigns, breached }: { leads: Lead[]; campaigns: { id: string; name: string }[]; breached: string[] }) {
  const [q, setQ] = useState(""); const [stage, setStage] = useState(""); const [camp, setCamp] = useState("");
  const rows = useMemo(() => leads.filter((l) =>
    (!q || (l.name + l.organisation + l.city).toLowerCase().includes(q.toLowerCase())) && (!stage || l.stage === stage) && (!camp || (camp === "none" ? !l.campaignId : l.campaignId === camp))), [leads, q, stage, camp]);
  return (
    <>
      <div className="toolbar">
        <input className="input" placeholder="Search name, firm, city" aria-label="Search leads" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" aria-label="Filter by stage" value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">All stages</option>{["new", "contacted", "demo_booked", "demo_done", "proposal", "won", "lost"].map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
        </select>
        <select className="select" aria-label="Filter by campaign" value={camp} onChange={(e) => setCamp(e.target.value)}>
          <option value="">All campaigns</option><option value="none">Untagged</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="sub">{rows.length} of {leads.length}</span>
      </div>
      <Table label="Leads" head={[{ t: "Lead" }, { t: "Firm" }, { t: "Role" }, { t: "City" }, { t: "Source" }, { t: "Stage" }, { t: "Owner" }, { t: "Created" }, { t: "SLA" }, { t: "Consent" }]}>
        {rows.map((l) => (
          <tr key={l.id}>
            <td><Link href={`/leads/${l.id}`}>{l.name}</Link></td><td>{l.organisation}</td><td>{l.role}</td><td>{l.city}</td>
            <td>{l.firstTouch.campaign ?? l.firstTouch.channel}</td><td><Badge>{stageLabel(l.stage)}</Badge></td><td>{l.owner}</td><td>{dateOnly(l.createdAt)}</td>
            <td>{breached.includes(l.id) ? <Badge kind="bad">Breached</Badge> : <Badge kind="ok">OK</Badge>}</td>
            <td>{l.consent.demoFollowup ? <Badge kind="ok">Granted</Badge> : <Badge kind="warn">None</Badge>}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
