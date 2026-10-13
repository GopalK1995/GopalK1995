"use client";
import Link from "next/link";
import { useState } from "react";
import type { Lead, Stage } from "@/data/types";
import { stageLabel } from "@/lib/format";

const COLS: Stage[] = ["new", "contacted", "demo_booked", "demo_done", "proposal", "won", "lost"];
export default function PipelineBoard({ leads }: { leads: Lead[] }) {
  const [st, setSt] = useState<Record<string, Stage>>(() => Object.fromEntries(leads.map((l) => [l.id, l.stage])));
  const moved = leads.filter((l) => st[l.id] !== l.stage).length;
  return (
    <>
      <p className="sub" style={{ marginBottom: 8 }}>Click-to-move demo (changes stay in this browser tab only; nothing is saved). {moved > 0 && `${moved} moved.`}</p>
      <div className="board">
        {COLS.map((c) => {
          const items = leads.filter((l) => st[l.id] === c);
          return (
            <div className="col" key={c} aria-label={stageLabel(c)}>
              <h3><span>{stageLabel(c)}</span><span className="muted">{items.length}</span></h3>
              {items.slice(0, 8).map((l) => (
                <div className="lead-card" key={l.id}>
                  <Link href={`/leads/${l.id}`}>{l.name}</Link><div className="muted">{l.organisation}</div>
                  <select aria-label={`Move ${l.name}`} value={st[l.id]} onChange={(e) => setSt({ ...st, [l.id]: e.target.value as Stage })}>
                    {COLS.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
                  </select>
                </div>
              ))}
              {items.length > 8 && <div className="sub">+{items.length - 8} more in Leads</div>}
            </div>
          );
        })}
      </div>
    </>
  );
}
