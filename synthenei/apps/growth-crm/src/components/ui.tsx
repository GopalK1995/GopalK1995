import type { ReactNode } from "react";

export function PageHead({ title, sub, chips }: { title: string; sub: string; chips?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1><p>{sub}</p></div>
      <div className="chips"><span className="badge mute">Last 30 days · IST</span>{chips}</div>
    </div>
  );
}
export const Badge = ({ kind = "", children }: { kind?: "ok" | "warn" | "bad" | "mock" | "mute" | ""; children: ReactNode }) => <span className={`badge ${kind}`}>{children}</span>;
export const Mock = ({ children = "Synthetic" }: { children?: ReactNode }) => <Badge kind="mock">{children}</Badge>;

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return <div className="card stat"><div className="label">{label}</div><div className="value">{value}</div>{note && <div className="note">{note}</div>}</div>;
}
export function Card({ title, sub, right, children }: { title?: string; sub?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || right) && <header><div><h2>{title}</h2>{sub && <div className="sub">{sub}</div>}</div>{right}</header>}
      {children}
    </section>
  );
}
export function Table({ head, children, label }: { head: { t: string; num?: boolean }[]; children: ReactNode; label: string }) {
  return (
    <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>
      <table><thead><tr>{head.map((h) => <th key={h.t} className={h.num ? "num" : ""}>{h.t}</th>)}</tr></thead><tbody>{children}</tbody></table>
    </div>
  );
}
export function HBars({ rows, color = "var(--s-1)", fmt }: { rows: { label: string; value: number; max?: number; right?: string }[]; color?: string; fmt?: (n: number) => string }) {
  const max = Math.max(...rows.map((r) => r.max ?? r.value), 1);
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <span className="lbl">{r.label}</span>
          <div className="bar-track" role="img" aria-label={`${r.label}: ${fmt ? fmt(r.value) : r.value}`}><div className="bar-fill" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: color }} /></div>
          <span className="val">{r.right ?? (fmt ? fmt(r.value) : r.value)}</span>
        </div>
      ))}
    </div>
  );
}
