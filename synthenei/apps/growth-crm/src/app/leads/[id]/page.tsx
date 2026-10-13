import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Mock, PageHead } from "@/components/ui";
import { leadById, leads, minutesBetween } from "@/data/leads";
import { campaignById } from "@/data/campaigns";
import { tasks } from "@/data/ops";
import { dateTime, dur, stageLabel } from "@/lib/format";

export function generateStaticParams() { return leads.map((l) => ({ id: l.id })); }

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = leadById(id);
  if (!l) notFound();
  const camp = campaignById(l.campaignId);
  const myTasks = tasks.filter((t) => t.leadId === l.id);
  return (
    <>
      <p style={{ marginBottom: 8 }}><Link href="/leads" className="muted">← All leads</Link></p>
      <PageHead title={l.name} sub={`${l.role} · ${l.organisation} · ${l.city}, ${l.state}`} chips={<><Badge>{stageLabel(l.stage)}</Badge><Mock /></>} />
      <div className="grid g-21">
        <Card title="Timeline" sub="lead_events, oldest first">
          <ul className="timeline">{l.events.map((e, i) => <li key={i}><div><strong>{e.name}</strong>{e.note ? ` · ${e.note}` : ""}<div className="when">{dateTime(e.at)}</div></div></li>)}</ul>
        </Card>
        <div className="stack">
          <Card title="AI summary" right={<Badge kind="mock">AI draft · sample</Badge>}>
            <div className="ai-box">{l.aiSummary}</div>
            <p className="sub" style={{ marginTop: 8 }}>Template text, not model output. Real summaries (Claude API) are off by default and must show the {l.events.length} events beside them.</p>
          </Card>
          <Card title="Source & ownership">
            <dl className="kv">
              <dt>First touch</dt><dd>{l.firstTouch.channel} · {l.firstTouch.campaign ?? "untagged"}</dd>
              <dt>Last touch</dt><dd>{l.lastTouch.channel} · {l.lastTouch.campaign ?? "untagged"}</dd>
              <dt>Campaign</dt><dd>{camp?.name ?? "None (organic / direct)"}</dd>
              <dt>Owner</dt><dd>{l.owner}</dd>
              <dt>Email</dt><dd>{l.email} {l.personalEmail && <Badge kind="warn">personal</Badge>}</dd>
              <dt>Firm size</dt><dd>{l.firmSize ?? "unknown"}</dd>
              <dt>Practice area</dt><dd>{l.practiceArea ?? "unknown"}</dd>
              <dt>First response</dt><dd>{l.firstResponseAt ? dur(minutesBetween(l.createdAt, l.firstResponseAt)) : "not yet"}</dd>
            </dl>
          </Card>
          <Card title="Consent (DPDP)">
            <dl className="kv"><dt>Demo follow-up</dt><dd>{l.consent.demoFollowup ? <Badge kind="ok">Granted</Badge> : <Badge kind="warn">Not recorded</Badge>}</dd>
              <dt>Marketing email</dt><dd>{l.consent.marketingEmail ? <Badge kind="ok">Granted</Badge> : <Badge kind="mute">Not granted</Badge>}</dd>
              <dt>Notice version</dt><dd>2026-10-v1</dd></dl>
          </Card>
          <Card title="Lead score" sub="Rule-based, not a prediction" right={<strong>{l.score}</strong>}>
            <ul className="list">{l.scoreParts.map((p) => <li key={p.label}>{p.label}: +{p.pts}</li>)}</ul>
          </Card>
          <Card title="Tasks">{myTasks.length ? <ul className="list">{myTasks.map((t) => <li key={t.id}>{t.title} · due {dateTime(t.dueAt)} · {t.status}</li>)}</ul> : <p className="muted">No open tasks.</p>}</Card>
        </div>
      </div>
    </>
  );
}
