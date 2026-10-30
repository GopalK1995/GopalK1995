"use client";
// Connector availability matrix: one row per connector, one cell per environment. Editing a cell saves immediately
// (super admin only; the database repeats the check). Cells without a row read "not set" (treated as disabled by the app).
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import type { ActionResult } from "./actions";
import { fieldCls } from "./action-dialog";
import { CONNECTOR_ENVS, CONNECTOR_MODES, GATES, type ConnectorEnv, type ConnectorMode, type ConnectorRow, type GateStatus } from "../_lib/repo";

const GATE_LABEL: Record<string, string> = { needs_vendor_approval: "Needs vendor approval", needs_client_credentials: "Needs client credentials", ready: "Ready" };

function Cell({ row, env, canEdit, action }: { row: ConnectorRow; env: ConnectorEnv; canEdit: boolean; action: (f: FormData) => Promise<ActionResult> }) {
  const cur = row.cells[env];
  const [mode, setMode] = useState<ConnectorMode>(cur?.mode ?? "disabled");
  const [gate, setGate] = useState<GateStatus>(cur?.gate ?? "needs_vendor_approval");
  const [pending, start] = useTransition();
  const save = (m: ConnectorMode, g: GateStatus) => {
    const fd = new FormData();
    fd.set("connector", row.id); fd.set("env", env); fd.set("mode", m); fd.set("gate", g); fd.set("note", cur?.note ?? "");
    start(async () => { const r = await action(fd); toast(r.message, r.sub); });
  };
  if (!canEdit) {
    return <div className="flex flex-col gap-1"><Badge tone={mode === "live" ? "success" : mode === "sandbox" ? "warn" : "outline"}>{cur ? mode : "not set"}</Badge><span className="text-[12px] text-ink-3">{GATE_LABEL[gate]}</span></div>;
  }
  return (
    <div className="flex flex-col gap-1" aria-busy={pending}>
      <select aria-label={`${row.name} mode in ${env}`} value={mode} disabled={pending} onChange={(e) => { const m = e.target.value as ConnectorMode; setMode(m); save(m, gate); }} className={`${fieldCls} h-8 text-[13px]`}>
        {CONNECTOR_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <select aria-label={`${row.name} gate in ${env}`} value={gate} disabled={pending} onChange={(e) => { const g = e.target.value as GateStatus; setGate(g); save(mode, g); }} className={`${fieldCls} h-8 text-[12px]`}>
        {GATES.map((g) => <option key={g} value={g}>{GATE_LABEL[g]}</option>)}
      </select>
    </div>
  );
}

export function ConnectorMatrix({ rows, canEdit, action }: { rows: ConnectorRow[]; canEdit: boolean; action: (f: FormData) => Promise<ActionResult> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-[13px]">
        <caption className="sr-only">Connector availability by environment</caption>
        <thead><tr className="text-[12px] uppercase tracking-[0.08em] text-ink-3">
          <th scope="col" className="px-4 py-2 font-medium">Connector</th>
          {CONNECTOR_ENVS.map((e) => <th key={e} scope="col" className="px-3 py-2 font-medium">{e}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line align-top">
              <th scope="row" className="px-4 py-2.5 font-medium text-ink">{r.name}<span className="block font-mono text-[12px] font-normal text-ink-3">{r.id} · {r.category}</span></th>
              {CONNECTOR_ENVS.map((e) => <td key={e} className="px-3 py-2.5"><Cell row={r} env={e} canEdit={canEdit} action={action} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
