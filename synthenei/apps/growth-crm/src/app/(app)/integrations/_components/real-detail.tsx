import Link from "next/link";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { Dl, PageHeader, Table, th, td } from "@/components/ui/misc";
import { EmptyState, PartialState } from "@/components/ui/states";
import { fmtDateTime } from "@/lib/format";
import { TRANSFORM_KEYS } from "@/lib/connectors/core/transforms";
import { ConnectorChip } from "./connector-chip";
import { ConnectPanel } from "./connect-panel";
import { FieldMapEditor } from "./field-map-editor";
import { Freshness } from "./real-list";
import { MAP_TABLES, type DetailView } from "../_lib/types";
import type { T } from "../_lib/strings";

const RUN_TONE: Record<string, ChipTone> = { success: "success", partial: "warn", failed: "danger", running: "info" };
/** Steps that need the vendor admin on the customer side; everything else is Synthan setup work. */
const CLIENT_STEP = /^(verify|approve|authorise|grant|register|request|connect|install|link|admin|workspace admin|entra|each rep|rep connects|create (a|an) (service|api|webhook))/i;

export interface DetailProps {
  v: DetailView; t: T; now: number; ws: string; failed: string[];
  /** Permission/support/demo reason that blocks management actions; null when the viewer may manage. */
  manageBlocked: string | null;
}

export function RealDetail({ v, t, now, ws, failed, manageBlocked }: DetailProps) {
  const r = v.row;
  const idle = r.chip === "available" || r.chip === "disconnected" || r.chip === "not_configured" || r.chip === "needs_vendor_approval" || r.chip === "needs_client_credentials" || r.chip === "not_available";
  const gateText = r.blockKey ? t(`blocked.${r.blockKey}`) : null;
  const connectBlocked = manageBlocked ?? gateText;
  const state = idle ? "idle" : r.chip === "needs_attention" || r.chip === "error" ? "attention" : "active";
  const mapLabels: Record<string, string> = {
    intro: t("mapIntro"), heading: t("sectionMap"), colObject: t("mapColObject"), colField: t("mapColField"), colTable: t("mapColTable"), colColumn: t("mapColColumn"),
    colDirection: t("mapColDirection"), colTransform: t("mapColTransform"), remove: t("mapRemove"), add: t("mapAdd"), save: t("mapSave"), preview: t("mapPreview"),
    sampleLabel: t("mapPreviewSample"), result: t("mapPreviewResult"), rejected: t("mapPreviewRejected", { fields: "{fields}" }), transformNone: t("mapTransformNone"),
    stageHelp: t("mapStageHelp"), "dir.in": t("dir.in"), "dir.out": t("dir.out"), "dir.both": t("dir.both"),
  };
  const defaultSample = JSON.stringify(Object.fromEntries(v.map.filter((m) => m.sample).map((m) => [m.externalField, m.sample])), null, 2);
  const editBlocked = manageBlocked ?? (v.editable ? null : t("blocked.not_connected"));
  const partialItems = [["runs", t("sectionLog")], ["map", t("sectionMap")], ["availability", t("partialAvailability")], ["connections", t("partialConnections")]] as const;

  return (
    <>
      <Link href="/integrations" className="mb-3 inline-flex items-center gap-1 text-12 font-medium text-ink-3 hover:text-ink"><ArrowLeft className="size-3.5" aria-hidden />{t("back")}</Link>
      <PageHeader eyebrow={t(`category.${r.category}`)} title={r.name}>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <ConnectorChip state={r.chip} label={t(`chip.${r.chip}`)} />
          {r.chip === "sandbox" && <span className="text-12 text-ink-2">{t("chipHint.sandbox")}</span>}
          {r.connectionId && <span className="text-12 text-ink-3">{t("colLastSync")}: <Freshness at={r.lastSyncAt} now={now} t={t} /></span>}
        </div>
      </PageHeader>

      {failed.length > 0 && <div className="mb-4"><PartialState done={partialItems.length - failed.length} total={partialItems.length} noun={t("partialNoun")} items={partialItems.map(([k, label]) => ({ label, status: failed.includes(k) ? "failed" as const : "ok" as const }))} /></div>}
      {r.chip === "sandbox" && <p role="note" className="state-warn mb-4 rounded-control border px-3 py-2 text-13 text-ink">{t("sandboxBanner")}</p>}
      {r.lastError && (r.chip === "needs_attention" || r.chip === "error") && <p role="alert" className="state-danger mb-4 rounded-control border px-3 py-2 text-13 text-ink">{r.lastError}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
          <Card>
            <CardHeader title={t("sectionConnect")} />
            <CardBody>
              {r.registered ? (
                <ConnectPanel connectorId={r.id} name={r.name} ws={ws} connectionId={r.connectionId} state={state} authKind={v.authKind} fields={v.fields}
                  connectBlocked={connectBlocked} manageBlocked={manageBlocked}
                  labels={{ connect: t("btnConnect"), authorise: t("btnAuthorise"), reconnect: t("btnReconnect"), test: t("btnTest"), disconnect: t("btnDisconnect"), runNow: t("btnRunNow"), cancel: t("btnCancel"), disconnectTitle: t("disconnectTitle", { name: r.name }), disconnectBody: t("disconnectBody"), generic: t("err.generic") }} />
              ) : <p className="text-13 text-ink-2">{t("blocked.not_shipped")}</p>}
            </CardBody>
          </Card>

          {v.steps.length > 0 && (
            <Card>
              <CardHeader title={t("sectionSteps")} sub={t("stepsOwnerNote")} />
              <CardBody>
                <ol className="flex flex-col">
                  {v.steps.map((step, i) => (
                    <li key={step} className="grid grid-cols-[28px_1fr] gap-3 pb-4 last:pb-0">
                      <span className="grid size-7 place-items-center rounded-round border border-line-strong bg-surface text-12 font-semibold num text-ink">{i + 1}</span>
                      <div className="min-w-0 pt-1"><p className="text-13 text-ink">{step}</p>{CLIENT_STEP.test(step) && <p className="mt-0.5 text-12 text-ink-3">Vendor admin</p>}</div>
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          )}

          {v.flows.length > 0 && (
            <Card>
              <CardHeader title={t("sectionFlows")} />
              <Table minWidth={420}>
                <thead><tr className="border-b border-line"><th className={th} scope="col">{t("flowObject")}</th><th className={th} scope="col">{t("flowDirection")}</th></tr></thead>
                <tbody>{v.flows.map((f) => (
                  <tr key={f.dir + f.object} className="border-b border-line"><td className={td}>{f.object}</td>
                    <td className={td}><span className="inline-flex items-center gap-1 text-ink-2">{f.dir === "in" ? <><ArrowDownLeft className="size-3.5 text-accent" aria-hidden />{t("flowIn")}</> : <><ArrowUpRight className="size-3.5 text-ink-3" aria-hidden />{t("flowOut")}</>}</span></td></tr>
                ))}</tbody>
              </Table>
            </Card>
          )}

          <Card>
            <CardHeader title={t("sectionMap")} />
            <CardBody>
              {v.map.length === 0 && !r.registered ? <p className="text-13 text-ink-2">{t("mapNone")}</p> : (
                <FieldMapEditor connectionId={r.connectionId} connectorId={r.id} rows={v.map} tables={MAP_TABLES} transforms={TRANSFORM_KEYS} blocked={editBlocked} defaultSample={defaultSample} labels={mapLabels} />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("sectionLog")} />
            {v.runs.length === 0 ? (
              <CardBody><EmptyState title={t("logEmpty")} body={t("logEmptyBody")} /></CardBody>
            ) : (
              <Table minWidth={720}>
                <caption className="sr-only">{t("sectionLog")}</caption>
                <thead><tr className="border-b border-line">
                  {["logColStarted", "logColStream", "logColKind", "logColStatus", "logColIn", "logColOut", "logColRejected", "logColNote"].map((k) => <th key={k} className={th} scope="col">{t(k)}</th>)}
                </tr></thead>
                <tbody>{v.runs.map((x) => (
                  <tr key={x.id} className="border-b border-line" data-run-status={x.status}>
                    <td className={`${td} num`}>{fmtDateTime(x.startedAt)}</td><td className={`${td} font-mono`}>{x.stream ?? "-"}</td><td className={td}>{t(`kind.${x.kind}`)}</td>
                    <td className={td}><Chip tone={RUN_TONE[x.status] ?? "neutral"}>{t(`run.${x.status}`)}</Chip></td>
                    <td className={`${td} num text-right`}>{x.rowsIn}</td><td className={`${td} num text-right`}>{x.rowsOut}</td><td className={`${td} num text-right`}>{x.rowsRejected}</td>
                    <td className={`${td} whitespace-normal text-ink-2`}>{x.error ?? ""}</td>
                  </tr>
                ))}</tbody>
              </Table>
            )}
          </Card>
        </div>

        <aside className="flex min-w-0 flex-col gap-4 lg:col-span-4">
          <Card>
            <CardHeader title={t("sectionAbout")} />
            <CardBody>
              <Dl items={[
                [t("colState"), <ConnectorChip key="s" state={r.chip} label={t(`chip.${r.chip}`)} />],
                [t("aboutAuth"), <span key="a" className="text-ink-2">{t(`auth.${v.authKind}`)}</span>],
                ...(r.mode ? [[t("aboutMode"), <span key="m" className="text-ink-2">{t(`mode.${r.mode}`)}</span>] as [string, React.ReactNode]] : []),
                [t("aboutSandbox"), <span key="sb" className="text-ink-2">{t(v.sandboxSupported ? "sandbox.supported" : "sandbox.unsupported")}</span>],
                ...(v.sandboxHowTo ? [["", <span key="h" className="text-12 text-ink-3">{t(v.sandboxHowTo)}</span>] as [string, React.ReactNode]] : []),
              ]} />
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}
