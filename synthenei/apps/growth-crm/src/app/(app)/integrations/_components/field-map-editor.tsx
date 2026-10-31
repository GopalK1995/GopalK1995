"use client";
// Field-mapping editor: their field -> our table.column with a transform. Edits replace the connector default for that field.
// Validation and preview run on the server (the transforms are server code); the editor only shows the result.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { Table, th, td } from "@/components/ui/misc";
import type { MapRowView } from "../_lib/types";
import { previewFieldMap, saveFieldMap } from "./actions";

export interface EditorProps {
  connectionId: string | null; connectorId: string; rows: MapRowView[]; tables: readonly string[]; transforms: readonly string[];
  /** Why saving is not possible (permission, support, demo, no connection); null when it is. */
  blocked: string | null; defaultSample: string; labels: Record<string, string>;
}
const sel = "h-8 w-full rounded-control border border-line-strong bg-surface px-2 text-13 text-ink disabled:opacity-45";

export function FieldMapEditor(p: EditorProps) {
  const router = useRouter();
  const [rows, setRows] = useState<MapRowView[]>(p.rows);
  const [pending, start] = useTransition();
  const [issues, setIssues] = useState<Record<number, string>>({});
  const [sample, setSample] = useState(p.defaultSample);
  const [preview, setPreview] = useState<{ mapped: Record<string, Record<string, unknown>>; rejected: string[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const dirty = useMemo(() => JSON.stringify(rows) !== JSON.stringify(p.rows), [rows, p.rows]);
  const L = p.labels;
  const off = !!p.blocked || pending;
  const edit = (i: number, patch: Partial<MapRowView>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch, custom: true } : r)));
  const payload = () => rows.map((r) => ({ externalObject: r.externalObject, externalField: r.externalField, localTable: r.localTable, localColumn: r.localColumn, direction: r.direction, transform: r.transform, transformArg: r.transformArg }));

  const save = () => start(async () => {
    if (!p.connectionId) return;
    const r = await saveFieldMap({ connectionId: p.connectionId, rows: payload() });
    toast(r.message, r.sub ?? "");
    if (r.ok) { setIssues({}); router.refresh(); } else if ("issues" in r && r.issues) setIssues(Object.fromEntries(r.issues.map((i) => [Number(i.path), i.message])));
  });
  const runPreview = () => start(async () => {
    const r = await previewFieldMap({ connectorId: p.connectorId, rows: payload(), sample });
    if (r.ok && r.data) { setPreview(r.data); setPreviewError(null); } else { setPreview(null); setPreviewError(r.message); }
  });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-13 text-ink-2">{L.intro}</p>
      <Table minWidth={900}>
        <caption className="sr-only">{L.heading}</caption>
        <thead><tr className="border-b border-line">
          {[L.colObject, L.colField, L.colTable, L.colColumn, L.colDirection, L.colTransform, ""].map((h, i) => <th key={i} className={th} scope="col">{h || <span className="sr-only">{L.remove}</span>}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.externalObject}|${r.externalField}|${i}`} className="border-b border-line align-top" data-custom={r.custom ? "true" : "false"}>
              <td className={td}><Input aria-label={L.colObject} value={r.externalObject} onChange={(e) => edit(i, { externalObject: e.target.value })} disabled={off} /></td>
              <td className={td}><Input aria-label={L.colField} value={r.externalField} onChange={(e) => edit(i, { externalField: e.target.value })} disabled={off} /></td>
              <td className={td}>
                <select aria-label={L.colTable} className={sel} value={r.localTable} onChange={(e) => edit(i, { localTable: e.target.value })} disabled={off}>
                  {!p.tables.includes(r.localTable) && <option value={r.localTable}>{r.localTable}</option>}
                  {p.tables.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </td>
              <td className={td}><Input aria-label={L.colColumn} className="font-mono" value={r.localColumn} onChange={(e) => edit(i, { localColumn: e.target.value })} disabled={off} /></td>
              <td className={td}>
                <select aria-label={L.colDirection} className={sel} value={r.direction} onChange={(e) => edit(i, { direction: e.target.value as MapRowView["direction"] })} disabled={off}>
                  {(["in", "out", "both"] as const).map((d) => <option key={d} value={d}>{L[`dir.${d}`]}</option>)}
                </select>
              </td>
              <td className={td}>
                <select aria-label={L.colTransform} className={sel} value={r.transform ?? ""} onChange={(e) => edit(i, { transform: e.target.value || null })} disabled={off}>
                  <option value="">{L.transformNone}</option>
                  {p.transforms.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {r.transform === "stage_key_map" && <Textarea aria-label={L.stageHelp} placeholder={L.stageHelp} className="mt-1 font-mono text-12" value={r.transformArg} onChange={(e) => edit(i, { transformArg: e.target.value })} disabled={off} />}
                {issues[i] && <p role="alert" className="mt-1 text-12 text-danger">{issues[i]}</p>}
              </td>
              <td className={td}><Button size="icon" variant="ghost" aria-label={L.remove} disabled={off} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Trash2 /></Button></td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={off} disabledReason={p.blocked ?? undefined} onClick={() => setRows((rs) => [...rs, { externalObject: rs[0]?.externalObject ?? "", externalField: "", localTable: p.tables[0] ?? "leads", localColumn: "", direction: "in", transform: null, transformArg: "", sample: "", custom: true }])}><Plus />{L.add}</Button>
        <Button variant="primary" disabled={pending || !dirty} disabledReason={p.blocked ?? undefined} onClick={save}><Save />{L.save}</Button>
      </div>

      <div className="grid gap-2 border-t border-line pt-3 md:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-13 font-medium text-ink" htmlFor="map-sample">{L.sampleLabel}</label>
          <Textarea id="map-sample" className="font-mono text-12" rows={6} value={sample} onChange={(e) => setSample(e.target.value)} />
          <div><Button disabled={pending} onClick={runPreview}><Eye />{L.preview}</Button></div>
        </div>
        <div className="grid content-start gap-1" aria-live="polite">
          <p className="text-13 font-medium text-ink">{L.result}</p>
          {previewError && <p role="alert" className="text-12 text-danger">{previewError}</p>}
          {preview && (
            <>
              <pre className="overflow-x-auto rounded-control border border-line bg-paper-2 p-2 font-mono text-12 text-ink" data-testid="map-preview">{JSON.stringify(preview.mapped, null, 2)}</pre>
              {preview.rejected.length > 0 && <p className="text-12 text-warn-ink">{L.rejected.replace("{fields}", preview.rejected.join(", "))}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
