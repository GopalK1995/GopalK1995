import { Badge, Card, Mock, PageHead, Table } from "@/components/ui";
import { integrations, syncRuns } from "@/data/ops";
import { dateTime } from "@/lib/format";
import type { IntegrationStatus } from "@/data/types";

const status: Record<IntegrationStatus, { label: string; kind: "ok" | "warn" | "bad" | "mock" | "mute" }> = {
  connected: { label: "Connected", kind: "ok" }, mock: { label: "Mock / CSV import", kind: "mock" }, csv_only: { label: "CSV only", kind: "warn" },
  error: { label: "Error", kind: "bad" }, not_configured: { label: "Not configured", kind: "mute" },
};
export default function IntegrationsPage() {
  return (
    <>
      <PageHead title="Integrations hub" sub="What feeds this CRM and how honest each connection is. At MVP, nothing is live-connected." chips={<Mock />} />
      <div className="grid g-3">
        {integrations.map((i) => (
          <section className="card" key={i.key}>
            <header><h2>{i.label}</h2><Badge kind={status[i.status].kind}>{status[i.status].label}</Badge></header>
            <p style={{ marginBottom: 8 }}>{i.honestNote}</p>
            <dl className="kv"><dt>Last sync</dt><dd>{i.lastSyncAt ? dateTime(i.lastSyncAt) : "never"}</dd><dt>Rows in</dt><dd>{i.rowsIn ?? "n/a"}</dd><dt>To connect</dt><dd>{i.howTo}</dd></dl>
            {(i.key === "linkedin" || i.key === "meta" || i.key === "email") && <p style={{ marginTop: 10 }}><button type="button" className="btn" disabled title="Importer not built yet">Import CSV (coming)</button></p>}
          </section>
        ))}
      </div>
      <Card title="Recent sync runs" sub="sync_runs table (sample rows)">
        <Table label="Sync runs" head={[{ t: "Integration" }, { t: "Started" }, { t: "Status" }, { t: "Rows in", num: true }, { t: "Rejected", num: true }, { t: "Note" }]}>
          {syncRuns.map((s) => <tr key={s.id}><td>{s.integration}</td><td>{dateTime(s.startedAt)}</td><td><Badge kind={s.status === "success" ? "ok" : s.status === "partial" ? "warn" : "bad"}>{s.status}</Badge></td><td className="num">{s.rowsIn}</td><td className="num">{s.rowsRejected}</td><td className="wrap-cell">{s.note}</td></tr>)}
        </Table>
      </Card>
    </>
  );
}
