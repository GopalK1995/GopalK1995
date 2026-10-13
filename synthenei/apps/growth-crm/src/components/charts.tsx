// Lightweight inline-SVG charts. No chart library.
const W = 640, Hh = 200, P = { l: 34, r: 8, t: 10, b: 24 };

export function LineChart({ labels, series, label }: { labels: string[]; series: { name: string; values: number[]; color: string }[]; label: string }) {
  const max = Math.max(...series.flatMap((s) => s.values), 1);
  const niceMax = Math.ceil(max / 10) * 10 || 10;
  const x = (i: number) => P.l + (i / Math.max(labels.length - 1, 1)) * (W - P.l - P.r);
  const y = (v: number) => Hh - P.b - (v / niceMax) * (Hh - P.t - P.b);
  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label={label}>
        {[0, 0.5, 1].map((f) => (<g key={f}><line x1={P.l} x2={W - P.r} y1={y(niceMax * f)} y2={y(niceMax * f)} stroke="var(--c-line)" /><text x={P.l - 6} y={y(niceMax * f) + 4} textAnchor="end">{Math.round(niceMax * f)}</text></g>))}
        {series.map((s) => <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />)}
        {[0, Math.floor(labels.length / 2), labels.length - 1].map((i) => <text key={i} x={x(i)} y={Hh - 6} textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}>{labels[i].slice(5)}</text>)}
      </svg>
      <div className="legend">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>
    </>
  );
}

export function ColumnChart({ labels, values, color = "var(--s-1)", label }: { labels: string[]; values: number[]; color?: string; label: string }) {
  const max = Math.max(...values, 1), niceMax = Math.max(Math.ceil(max / 2) * 2, 2);
  const bw = (W - P.l - P.r) / values.length;
  const y = (v: number) => Hh - P.b - (v / niceMax) * (Hh - P.t - P.b);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label={label}>
      {[0, 0.5, 1].map((f) => (<g key={f}><line x1={P.l} x2={W - P.r} y1={y(niceMax * f)} y2={y(niceMax * f)} stroke="var(--c-line)" /><text x={P.l - 6} y={y(niceMax * f) + 4} textAnchor="end">{Math.round(niceMax * f)}</text></g>))}
      {values.map((v, i) => <rect key={i} x={P.l + i * bw + 1.5} y={y(v)} width={Math.max(bw - 3, 2)} height={Hh - P.b - y(v)} rx={2} fill={color}><title>{`${labels[i]}: ${v}`}</title></rect>)}
      {[0, Math.floor(labels.length / 2), labels.length - 1].map((i) => <text key={i} x={P.l + i * bw + bw / 2} y={Hh - 6} textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}>{labels[i].slice(5)}</text>)}
    </svg>
  );
}
