"use client";
import { useState } from "react";
import type { Lead } from "@/data/types";
import { HBars, Table } from "./ui";
import { pct } from "@/lib/format";

export default function Attribution({ leads }: { leads: Lead[] }) {
  const [model, setModel] = useState<"first" | "last">("first");
  const t = (l: Lead) => (model === "first" ? l.firstTouch : l.lastTouch);
  const agg = (key: (l: Lead) => string) => {
    const m = new Map<string, { n: number; demos: number }>();
    leads.forEach((l) => { const k = key(l); const v = m.get(k) ?? { n: 0, demos: 0 }; v.n++; if (l.maxStageIdx >= 2) v.demos++; m.set(k, v); });
    return [...m.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.n - a.n);
  };
  const byChannel = agg((l) => t(l).channel);
  const byCampaign = agg((l) => t(l).campaign ?? "(untagged)");
  const untagged = leads.filter((l) => !t(l).campaign).length;
  return (
    <>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Attribution model">
          <button type="button" aria-pressed={model === "first"} onClick={() => setModel("first")}>First touch</button>
          <button type="button" aria-pressed={model === "last"} onClick={() => setModel("last")}>Last touch</button>
        </div>
        <span className="sub">Untagged (no UTM): {untagged} leads, {pct(untagged / leads.length, 0)}</span>
      </div>
      <div className="grid g-2">
        <section className="card"><header><h2>Leads by channel</h2></header><HBars rows={byChannel.map((r) => ({ label: r.label, value: r.n, right: `${r.n} · ${pct(r.n / leads.length, 0)}` }))} /></section>
        <section className="card"><header><h2>Demos by channel</h2></header><HBars color="var(--s-2)" rows={byChannel.map((r) => ({ label: r.label, value: r.demos, max: Math.max(...byChannel.map((x) => x.demos), 1), right: `${r.demos} of ${r.n}` }))} /></section>
      </div>
      <Table label="By utm_campaign" head={[{ t: "utm_campaign" }, { t: "Leads", num: true }, { t: "Demos booked", num: true }, { t: "Lead→demo", num: true }]}>
        {byCampaign.map((r) => <tr key={r.label}><td>{r.label}</td><td className="num">{r.n}</td><td className="num">{r.demos}</td><td className="num">{pct(r.demos / r.n, 0)}</td></tr>)}
      </Table>
    </>
  );
}
