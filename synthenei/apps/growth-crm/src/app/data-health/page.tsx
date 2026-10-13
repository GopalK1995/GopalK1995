import { Badge, Card, Mock, PageHead, Stat, Table } from "@/components/ui";
import { getBackupAdapter } from "@/lib/backup";
import { dateTime, dur, num } from "@/lib/format";
import { NOW_ISO } from "@/data/leads";

const kindLabel = { supabase_daily: "Supabase daily backup", logical_dump: "Own logical dump (pg_dump)", restore_drill: "Restore drill" } as const;
export default async function DataHealthPage() {
  const snap = await getBackupAdapter().getSnapshot();
  const now = new Date(NOW_ISO).getTime();
  const ageH = (iso: string | null) => (iso ? (now - new Date(iso).getTime()) / 3600e3 : Infinity);
  const daily = snap.checks.find((c) => c.kind === "supabase_daily")!;
  const dump = snap.checks.find((c) => c.kind === "logical_dump")!;
  const drill = snap.checks.find((c) => c.kind === "restore_drill")!;
  const fresh = ageH(daily.takenAt) <= snap.staleAfterHours && daily.status === "success";
  const mb = (b: number | null) => (b ? (b / 1e6).toFixed(1) + " MB" : "n/a");
  return (
    <>
      <PageHead title="Data & backup monitor" sub="Is the database backed up, restorable, and complete? Adapter-driven: swap the mock for a real check in src/lib/backup.ts." chips={snap.isMock ? <Badge kind="mock">MOCK adapter ({getBackupAdapter().name})</Badge> : undefined} />
      <div className="grid g-4">
        <Stat label="Last successful backup (M24)" value={dur(ageH(daily.takenAt) * 60) + " ago"} note={<>{fresh ? <Badge kind="ok">Within {snap.staleAfterHours} h</Badge> : <Badge kind="bad">Stale</Badge>} · {dateTime(daily.takenAt!)}</>} />
        <Stat label="Retention" value={snap.retentionDays != null ? `${snap.retentionDays} days` : "unknown"} note="Free/Pro plan figure from Supabase docs" />
        <Stat label="Point-in-time recovery" value={snap.pitrEnabled ? "On" : "Off"} note={snap.pitrEnabled ? "" : <Badge kind="warn">Paid add-on, not enabled</Badge>} />
        <Stat label="Last restore drill (M26)" value={dur(ageH(drill.takenAt) * 60)} note={<>ago · target every 90 days</>} />
      </div>
      <div className="grid g-2">
        <Card title="Backup checks" sub="backup_checks table">
          <Table label="Backup checks" head={[{ t: "Check" }, { t: "Status" }, { t: "Taken" }, { t: "Size", num: true }, { t: "Location" }]}>
            {snap.checks.map((c) => <tr key={c.kind}><td>{kindLabel[c.kind]}</td><td><Badge kind={c.status === "success" ? "ok" : "bad"}>{c.status}</Badge></td><td>{c.takenAt ? dateTime(c.takenAt) : "never"}</td><td className="num">{mb(c.sizeBytes)}</td><td>{c.location}</td></tr>)}
          </Table>
          <p className="sub" style={{ marginTop: 8 }}>Last own dump {dur(ageH(dump.takenAt) * 60)} ago, {mb(dump.sizeBytes)}.</p>
          <div className="callout"><strong>Not covered by Supabase backups:</strong> {snap.notCovered.join("; ")}.</div>
        </Card>
        <Card title="Row counts vs last dump (M25)" sub="Flag if a table drops more than 5%">
          <Table label="Row counts" head={[{ t: "Table" }, { t: "Now", num: true }, { t: "At last dump", num: true }, { t: "Change", num: true }, { t: "" }]}>
            {snap.tableCounts.map((t) => { const ch = t.atLastDump ? (t.current - t.atLastDump) / t.atLastDump : 0; return <tr key={t.table}><td>{t.table}</td><td className="num">{num(t.current)}</td><td className="num">{num(t.atLastDump)}</td><td className="num">{(ch * 100).toFixed(1)}%</td><td>{ch < -0.05 ? <Badge kind="bad">Drop</Badge> : <Badge kind="ok">OK</Badge>}</td></tr>; })}
          </Table>
        </Card>
        <Card title="Alert rules" sub="backup_alert_rules (delivery not built yet)">
          <Table label="Alert rules" head={[{ t: "Rule" }, { t: "Condition" }, { t: "Notify" }, { t: "On" }]}>
            {snap.alertRules.map((r) => <tr key={r.id}><td>{r.name}</td><td className="wrap-cell">{r.condition}</td><td>{r.notifyTo}</td><td>{r.enabled ? <Badge kind="ok">On</Badge> : <Badge kind="mute">Off</Badge>}</td></tr>)}
          </Table>
        </Card>
        <Card title="Restore-drill log">
          <Table label="Restore drills" head={[{ t: "Date" }, { t: "Result" }, { t: "Minutes", num: true }, { t: "Notes" }]}>
            {snap.drillLog.map((d) => <tr key={d.at}><td>{dateTime(d.at)}</td><td><Badge kind={d.result === "pass" ? "ok" : "bad"}>{d.result}</Badge></td><td className="num">{d.durationMin}</td><td className="wrap-cell">{d.notes}</td></tr>)}
          </Table>
        </Card>
      </div>
    </>
  );
}
