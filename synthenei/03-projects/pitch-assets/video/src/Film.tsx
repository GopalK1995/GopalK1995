import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Audio, Easing, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import "@fontsource/source-serif-4/500.css";
import "@fontsource/source-serif-4/600.css";
import "./landing/tokens.css";
import "./landing/screens.css";
import "./video.css";
import { AppFrame } from "./landing/AppFrame";
import {
  firm, stats, statusBars, growth, months, upcomingHearings, sites, cases, calendarEvents, team, savedCases,
} from "./landing/demo";

/* ---------- timeline (30 fps) ---------- */
const S = {
  cold: { from: 0, dur: 135 },
  title: { from: 135, dur: 105 },
  dash: { from: 240, dur: 240 },
  cal: { from: 480, dur: 180 },
  cases: { from: 660, dur: 240 },
  team: { from: 900, dur: 180 },
  ecourts: { from: 1080, dur: 180 },
  nidhi: { from: 1260, dur: 270 },
  pillars: { from: 1530, dur: 135 },
  end: { from: 1665, dur: 135 },
};
export const TOTAL = 1800;

/* ---------- palette (60 light / 30 navy / 10 blue) ---------- */
const NAVY = "#0a1230";
const NAVY_2 = "#0f1b3f";
const BLUE = "#2547d0";
const BLUE_ON_NAVY = "#9db3ff";
const LIGHT = "#f6f7fb";
const INK = "#0f172a";
const INK_2 = "#475069";

/* ---------- motion helpers ---------- */
const EASE = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IN = Easing.bezier(0.7, 0, 0.84, 0);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const tw = (f: number, start: number, dur: number, from = 0, to = 1) =>
  interpolate(f, [start, start + dur], [from, to], { ...clamp, easing: EASE });
const twIn = (f: number, start: number, dur: number, from = 0, to = 1) =>
  interpolate(f, [start, start + dur], [from, to], { ...clamp, easing: EASE_IN });

/** Masked line reveal: text rises from below a clipping edge. */
function Line({ f, at, children, style, dur = 20 }: { f: number; at: number; children: ReactNode; style?: CSSProperties; dur?: number }) {
  const y = tw(f, at, dur, 105, 0);
  return (
    <div style={{ overflow: "hidden", paddingBottom: "0.16em", marginBottom: "-0.08em" }}>
      <div style={{ transform: `translateY(${y}%)`, ...style }}>{children}</div>
    </div>
  );
}

/** Fade + slide that every element uses on its way in. */
function In({ f, at, children, dx = 0, dy = 24, dur = 18, style }: { f: number; at: number; children: ReactNode; dx?: number; dy?: number; dur?: number; style?: CSSProperties }) {
  const p = tw(f, at, dur);
  return <div style={{ opacity: p, transform: `translate(${(1 - p) * dx}px, ${(1 - p) * dy}px)`, ...style }}>{children}</div>;
}

/** Scene exit: everything drifts left and fades (keeps the left-to-right flow). */
function Exit({ f, dur, children, len = 12 }: { f: number; dur: number; children: ReactNode; len?: number }) {
  const p = twIn(f, dur - len, len);
  return <AbsoluteFill style={{ opacity: 1 - p, transform: `translateX(${-60 * p}px)` }}>{children}</AbsoluteFill>;
}

/* ---------- shared layout for product scenes ---------- */
function ProductScene({
  f, dur, step, eyebrow, title, sub, note, appLeft = 680, appWidth, appScale, push = 0.05, origin = "50% 50%", focus, children,
}: {
  f: number; dur: number; step: string; eyebrow: string; title: string[]; sub?: string; note?: ReactNode;
  appLeft?: number; appTop?: number; appWidth: number; appScale: number; push?: number; origin?: string; children: ReactNode;
  focus?: { at: number; from?: number; to: number; origin: string; dur?: number };
}) {
  const { fps } = useVideoConfig();
  const enter = spring({ frame: f - 4, fps, config: { damping: 200, mass: 0.9, stiffness: 90 } });
  const tilt = (1 - enter) * 16;
  const lift = (1 - enter) * 140;
  const cam = interpolate(f, [0, dur], [1, 1 + push], { ...clamp, easing: Easing.inOut(Easing.quad) });
  return (
    <Exit f={f} dur={dur}>
      <div style={{ position: "absolute", left: 120, top: 0, bottom: 0, width: 500, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <In f={f} at={2} dy={12}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 20, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: BLUE }}>
            <span style={{ fontVariantNumeric: "tabular-nums", color: "#8089a3" }}>{step}</span>
            <span style={{ width: 28, height: 2, background: "#c9d1e6" }} />
            {eyebrow}
          </div>
        </In>
        <div style={{ marginTop: 22, font: "600 52px/1.1 var(--font-serif)", letterSpacing: "-0.02em", color: INK }}>
          {title.map((t, i) => (<Line key={i} f={f} at={6 + i * 5}>{t}</Line>))}
        </div>
        {sub && (<In f={f} at={20} dy={14}><p style={{ marginTop: 24, fontSize: 24, lineHeight: 1.4, color: INK_2, fontWeight: 500 }}>{sub}</p></In>)}
        {note && <In f={f} at={30} dy={10}><div style={{ marginTop: 28 }}>{note}</div></In>}
      </div>
      <div style={{ position: "absolute", left: appLeft, right: 40, top: 0, bottom: 0, display: "flex", alignItems: "center", perspective: 2200, perspectiveOrigin: "50% 0%" }}>
        <div style={{ width: appWidth, zoom: appScale } as CSSProperties}>
          <div style={{ opacity: Math.min(1, enter * 1.6), transform: `translateY(${lift}px) rotateX(${tilt}deg) scale(${cam})`, transformOrigin: origin }}>
            {focus ? (
              <div style={{ borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 60px rgba(10,18,48,.16), 0 2px 6px rgba(10,18,48,.08)" }}>
                <div style={{ transform: `scale(${tw(f, focus.at, focus.dur ?? 30, focus.from ?? 1, focus.to)})`, transformOrigin: focus.origin }}>{children}</div>
              </div>
            ) : children}
          </div>
        </div>
      </div>
    </Exit>
  );
}

/* ---------- 1. cold open ---------- */
function ColdOpen() {
  const f = useCurrentFrame();
  const out = twIn(f, 120, 15);
  const big: CSSProperties = { font: "600 104px/1.08 var(--font-serif)", letterSpacing: "-0.025em", color: "#fff" };
  return (
    <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 200, opacity: 1 - out, transform: `translateY(${-40 * out}px)` }}>
      <In f={f} at={4} dy={10}>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#8a97c4", marginBottom: 34 }}>Chennai · Egmore Office</div>
      </In>
      <Line f={f} at={8} style={big}>Hearing day, 9:40 am.</Line>
      <Line f={f} at={34} style={big}>Three hearings.</Line>
      <Line f={f} at={64} style={{ ...big, color: BLUE_ON_NAVY }}>Which lawyer is where?</Line>
    </AbsoluteFill>
  );
}

/* ---------- 2. title card ---------- */
function Wordmark({ size = 34, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <div style={{ fontWeight: 800, letterSpacing: "0.16em", fontSize: size, color }}>
      LAWS<span style={{ color: "#3b61e8" }}>O</span>ME
    </div>
  );
}
function TitleCard() {
  const f = useCurrentFrame();
  const rule = tw(f, 10, 26);
  return (
    <Exit f={f} dur={S.title.dur} len={10}>
      <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 200 }}>
        <In f={f} at={0} dy={16}><Wordmark size={36} /></In>
        <div style={{ height: 2, width: 120 * rule, background: "#3b61e8", margin: "34px 0 40px" }} />
        <div style={{ font: "600 120px/1.04 var(--font-serif)", letterSpacing: "-0.03em", color: "#fff" }}>
          <Line f={f} at={12} dur={22}>Your entire law firm.</Line>
          <Line f={f} at={26} dur={22} style={{ color: BLUE_ON_NAVY }}>One clear view.</Line>
        </div>
      </AbsoluteFill>
    </Exit>
  );
}

/* ---------- 3. dashboard ---------- */
function GrowthLine({ p }: { p: number }) {
  const W = 300, H = 110, max = 10;
  const pts = growth.map((v, i) => [(i / (growth.length - 1)) * W, H - (v / max) * H] as const);
  const d = pts.map(([x, y], i) => (i ? `L${x},${y}` : `M${x},${y}`)).join(" ");
  return (
    <svg viewBox={`-6 -8 ${W + 12} ${H + 28}`} width="100%">
      {[0, 5, 10].map((g) => (<line key={g} x1="0" x2={W} y1={H - (g / max) * H} y2={H - (g / max) * H} stroke="#e8ebf4" strokeDasharray="3 3" />))}
      <path d={d} pathLength={1} fill="none" stroke="var(--c-blue-600)" strokeWidth="2" strokeLinejoin="round" strokeDasharray="1 1" strokeDashoffset={1 - p} />
      {pts.map(([x, y], i) => (<circle key={i} cx={x} cy={y} r="2.6" fill="var(--c-blue-600)" opacity={p >= i / (pts.length - 1) ? 1 : 0} />))}
      {months.map((m, i) => (<text key={m} x={(i / (months.length - 1)) * W} y={H + 14} fontSize="7" textAnchor="middle" fill="#8a93ad">{m}</text>))}
    </svg>
  );
}
function DashboardScene() {
  const f = useCurrentFrame();
  const c = (n: number, at: number) => Math.round(n * tw(f, at, 18));
  const kpis = [
    { ico: "▤", n: c(stats.total, 6), label: `Total cases · ${stats.thisMonth} this month` },
    { ico: "⚖", n: c(stats.upcoming, 8), label: "Upcoming hearings" },
    { ico: "✓", n: c(stats.resolved, 10), label: "Resolved cases" },
    { ico: "☺", n: c(stats.team, 12), label: `Lawyers & staff · ${stats.sites} sites` },
  ];
  return (
    <ProductScene f={f} dur={S.dash.dur} step="01" eyebrow="Firm intelligence" title={["See the whole firm", "on one screen."]}
      sub="Raghavan Law Chambers, Chennai and Madurai." appWidth={820} appScale={1.46} push={0} focus={{ at: 96, to: 1.3, origin: "100% 100%", dur: 36 }}>
      <AppFrame active="Dashboard" url="organization/dashboard">
        <div className="banner">
          <div><h4>{firm.name}</h4><div className="chips">{firm.tags.map((t, i) => <span key={t} className={`chip${i === 0 ? " fill" : ""}`}>{t}</span>)}<span className="chip">{stats.sites} sites</span></div></div>
          <div className="qa">+ Quick actions</div>
        </div>
        <div className="cards4">
          {kpis.map((k, i) => (
            <In key={i} f={f} at={4 + i * 2} dy={10}><div className="c stat"><div className="ico">{k.ico}</div><strong style={{ fontVariantNumeric: "tabular-nums" }}>{k.n}</strong><span>{k.label}</span></div></In>
          ))}
        </div>
        <div className="cols">
          <div>
            <div className="c"><h5>Cases by status <em>{stats.total - stats.resolved} active matters</em></h5>
              {statusBars.map((s, i) => (<div className="bar" key={s.label}><div><span>{s.label}</span><span>{Math.round(s.n * tw(f, 14 + i * 3, 22))}</span></div><i><b style={{ width: `${(s.n / 17) * 100 * tw(f, 14 + i * 3, 22)}%`, background: s.color }} /></i></div>))}
            </div>
            <div className="c"><h5>Firm growth – incoming cases <em>YTD</em></h5><GrowthLine p={tw(f, 20, 40)} /></div>
          </div>
          <div>
            <div className="c"><h5>Upcoming hearings</h5>
              {upcomingHearings.map((h, i) => (<In key={h.title} f={f} at={14 + i * 3} dx={16} dy={0}><div className="hear"><div className="dt">{h.d}<small>{h.m}</small></div><div><b>{h.title}</b><span>{h.where}</span></div></div></In>))}
            </div>
            <div className="c"><h5>Sites</h5>{sites.map((s, i) => (<In key={s.key} f={f} at={20 + i * 3} dx={16} dy={0}><div className="hear"><div><b>{s.name}</b><span>{s.where.split(" - ")[0]}</span></div></div></In>))}</div>
          </div>
        </div>
      </AppFrame>
    </ProductScene>
  );
}

/* ---------- 4. calendar ---------- */
function CalendarScene() {
  const f = useCurrentFrame();
  const cells = Array.from({ length: 35 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 8, 27 + i));
    const iso = date.toISOString().slice(0, 10);
    return { n: date.getUTCDate(), iso, mut: date.getUTCMonth() !== 9 };
  });
  // event order for the pop-in sequence
  const order = Object.keys(calendarEvents).sort();
  // camera: zoom into the week of 20 Oct inside the window
  const zoom = tw(f, 60, 50, 1.35, 1.75);
  const focus = "47% 78%";
  const ring = tw(f, 104, 16);
  return (
    <ProductScene f={f} dur={S.cal.dur} step="02" eyebrow="Hearings & calendar" title={["Hearings and tasks.", "One calendar."]}
      sub="Hearings, tasks and notes, side by side." appWidth={820} appScale={1.46} push={0}>
      <div style={{ borderRadius: 16, overflow: "hidden", boxShadow: "var(--shadow-float)" }}>
        <div style={{ transform: `scale(${zoom})`, transformOrigin: focus }}>
          <AppFrame active="Calendar" url="organization/calendar">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div className="page-h"><h4>October 2026</h4></div>
              <div className="legend"><span><i style={{ background: "var(--c-closed)" }} />Hearings</span><span><i style={{ background: "#e08a2f" }} />Tasks</span><span><i style={{ background: "#8a93ad" }} />Notes</span></div>
            </div>
            <div className="cal">
              {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => <div className="dh" key={d}>{d}</div>)}
              {cells.map((c) => {
                const k = order.indexOf(c.iso);
                const isFocus = c.iso === "2026-10-20";
                return (
                  <div key={c.iso} className={`d${c.mut ? " mut" : ""}${c.iso === "2026-10-13" ? " today" : ""}`}
                    style={isFocus ? { boxShadow: `inset 0 0 0 ${2 * ring}px ${BLUE}`, background: `rgba(37,71,208,${0.05 * ring})` } : undefined}>
                    {c.iso === "2026-10-13" ? <b>{c.n}</b> : c.n}
                    {(calendarEvents[c.iso] ?? []).slice(0, 3).map((e, i) => {
                      const at = 18 + k * 6 + i * 3;
                      const s = tw(f, at, 12);
                      return <span key={i} className={`ev ${e.kind}`} style={{ opacity: s, transform: `scale(${0.85 + 0.15 * s})`, transformOrigin: "0 50%" }}>{e.text}</span>;
                    })}
                  </div>
                );
              })}
            </div>
          </AppFrame>
        </div>
      </div>
    </ProductScene>
  );
}

/* ---------- 5. cases ---------- */
const statusClass: Record<string, string> = { Open: "", "In Progress": " amber", "On Hold": " grey" };
function CasesScene() {
  const f = useCurrentFrame();
  // highlight travels down the rows and settles on the first matter with no hearing date (row 3)
  const pos = interpolate(f, [40, 96], [0, 3], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const hl = tw(f, 34, 10) * (1 - twIn(f, 190, 20));
  const missing = cases.map((c, i) => (c.hearing ? -1 : i)).filter((i) => i >= 0);
  return (
    <ProductScene f={f} dur={S.cases.dur} step="03" eyebrow="Case control" title={["Spot matters with", "no hearing date."]}
      sub="Owner and next hearing on every row." appWidth={860} appScale={1.39} push={0} focus={{ at: 74, to: 1.35, origin: "75% 95%", dur: 36 }}>
      <AppFrame active="Cases" url="organization/cases">
        <div className="filters"><span className="s">Search by title, case number, site…</span><span>All status ▾</span><span>All sites ▾</span><span>All assignees ▾</span></div>
        <div className="c" style={{ padding: 0 }}>
          <table className="tbl"><thead><tr><th>Case</th><th>Case no.</th><th>Next hearing</th><th>Site</th><th>Status</th><th>Assigned to</th></tr></thead>
            <tbody>{cases.map((c, i) => {
              const near = Math.max(0, 1 - Math.abs(pos - i)) * hl;
              const k = missing.indexOf(i);
              const flagAt = 100 + k * 14;
              const lit = k >= 0 ? tw(f, flagAt, 10) : 0;
              const pulseT = interpolate(f, [flagAt, flagAt + 20], [0, 1], clamp);
              const pulse = k === 0 ? Math.sin(Math.PI * pulseT) : 0;
              return (
                <tr key={c.ref} style={{ background: `rgba(37,71,208,${0.08 * near})`, opacity: tw(f, 6 + i * 2, 12) }}>
                  <td><b>{c.title}</b><small>{c.ref}</small></td><td>{c.no}</td>
                  <td>{c.hearing ?? (
                    <span className="miss" style={{ display: "inline-block", padding: "2px 7px", borderRadius: 99, background: `rgba(255,244,224,${lit})`, boxShadow: `0 0 0 ${3 * pulse}px rgba(161,92,7,${0.25 * pulse})`, transform: `scale(${1 + 0.1 * pulse})`, transformOrigin: "0 50%" }}>⚠ Hearing date missing</span>
                  )}</td>
                  <td>{c.site}</td><td><span className={`pill${statusClass[c.status] ?? ""}`}>● {c.status}</span></td>
                  <td><span className="av">{c.who.split(" ")[1][0]}</span>{c.who}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </AppFrame>
    </ProductScene>
  );
}

/* ---------- 6. team & sites ---------- */
function TeamScene() {
  const f = useCurrentFrame();
  return (
    <ProductScene f={f} dur={S.team.dur} step="04" eyebrow="Multi-site team" title={["Two offices.", "One firm."]}
      sub="Egmore, Chennai and KK Nagar, Madurai." appWidth={820} appScale={1.46} push={0} focus={{ at: 70, from: 1.3, to: 1, origin: "91% 8%", dur: 36 }}>
      <AppFrame active="Users" url="organization/users">
        <div className="page-h"><h4>Sites</h4><p>Each site has its own cases, lawyers and clients.</p></div>
        <div className="grid3" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
          {sites.map((s, i) => (
            <In key={s.key} f={f} at={6 + i * 4} dy={18}><div className="c"><div className="person"><div className="big">{s.name.slice(0, 2).toUpperCase()}</div><div><b>{s.name}</b><span>{s.key}</span></div></div>
              <p style={{ margin: "8px 0", color: "#6b7390" }}>⌖ {s.where}</p>
              <div style={{ display: "flex", gap: 18 }}><div><b style={{ font: "600 18px var(--font-serif)" }}>{Math.round(s.cases * 1)}</b><br />CASES</div><div><b style={{ font: "600 18px var(--font-serif)" }}>{Math.round(s.staff * 1)}</b><br />STAFF</div></div></div></In>
          ))}
        </div>
        <div className="page-h" style={{ marginTop: 4 }}><h4>Lawyers</h4><p>Roles and sites for every lawyer and staff member.</p></div>
        <div className="grid3">
          {team.map((p, i) => (<In key={p.name} f={f} at={84 + i * 4} dy={14}><div className="c person"><div className="big">{p.initials}</div><div><b>{p.name}</b><span>{p.role}</span><span>⌖ {p.site}</span></div></div></In>))}
        </div>
      </AppFrame>
    </ProductScene>
  );
}

/* ---------- 7. eCourts ---------- */
function ECourtsScene() {
  const f = useCurrentFrame();
  const cnr = savedCases[0].cnr;
  const typed = cnr.slice(0, Math.floor(interpolate(f, [34, 34 + cnr.length * 2.2], [0, cnr.length], clamp)));
  const caretOn = typed.length < cnr.length ? true : Math.floor(f / 15) % 2 === 0;
  const pressT = interpolate(f, [86, 92, 98], [1, 0.94, 1], clamp);
  const res = tw(f, 104, 16);
  const saved = f >= 140;
  const r = savedCases[0];
  return (
    <ProductScene f={f} dur={S.ecourts.dur} step="05" eyebrow="eCourts" title={["Search eCourts", "by CNR number."]}
      sub="Or by advocate, case number or party." appWidth={740} appScale={1.6} push={0} focus={{ at: 14, to: 1.2, origin: "100% 100%", dur: 30 }}>
      <AppFrame active="eCourts" url="organization/ecourts">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="page-h"><h4>eCourts</h4><p>Search, track, and manage court cases.</p></div>
          <div className="tabs"><span className="on">Search</span><span>Saved Cases</span><span>History</span><span>Refresh Queue</span></div>
        </div>
        <div className="c">
          <div className="tabs" style={{ marginBottom: 12 }}><span className="on">CNR Number</span><span>Advocate</span><span>Case Number</span><span>Party Name</span></div>
          <div className="row">
            <div className="fld" style={{ flex: 1 }}>CNR number
              <span style={{ fontFamily: "ui-monospace, 'DejaVu Sans Mono', monospace", letterSpacing: "0.06em", boxShadow: f > 28 && f < 100 ? `0 0 0 2px rgba(37,71,208,.25)` : "none", borderColor: f > 28 && f < 100 ? BLUE : undefined }}>
                {typed || <span style={{ color: "#9aa3bd", border: 0, padding: 0, background: "none", fontFamily: "var(--font-sans)", letterSpacing: 0 }}>16-character CNR</span>}
                <i style={{ display: "inline-block", width: 1.5, height: 12, background: INK, marginLeft: 1, verticalAlign: "-2px", opacity: f > 28 && f < 104 && caretOn ? 1 : 0 }} />
              </span>
            </div>
            <div className="btnp" style={{ transform: `scale(${pressT})` }}>Search</div>
          </div>
        </div>
        <div className="c" style={{ padding: 0, opacity: res, transform: `translateY(${(1 - res) * 12}px)` }}>
          <table className="tbl"><thead><tr><th>CNR</th><th>Case title</th><th>Court</th><th>Status</th><th /></tr></thead>
            <tbody><tr><td><b>{r.cnr}</b></td><td>{r.title}</td><td>{r.court}</td><td><span className="pill amber">● {r.status}</span></td>
              <td style={{ textAlign: "right" }}><span className={`pill${saved ? " ok" : ""}`} >{saved ? "✓ Saved" : "+ Save case"}</span></td></tr></tbody>
          </table>
        </div>
      </AppFrame>
    </ProductScene>
  );
}

/* ---------- 8. Ask Nidhi ---------- */
const QUESTION = "We have received a new property dispute involving a disagreement over ownership and a registered sale deed. Find relevant cases already handled by our firm and identify potentially relevant external judgments for further review.";
function NidhiScene() {
  const f = useCurrentFrame();
  const q = tw(f, 24, 16);
  const thinking = f >= 52 && f < 96;
  const dot = (i: number) => 0.3 + 0.7 * Math.max(0, Math.sin(((f - i * 4) / 30) * Math.PI * 2));
  const sec = (i: number) => tw(f, 96 + i * 22, 18);
  const note = (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #e3e7f1", borderLeft: `4px solid ${BLUE}`, borderRadius: 8, padding: "14px 18px", fontSize: 22, fontWeight: 700, color: NAVY_2 }}>
      Research support. Verify all sources.
    </div>
  );
  return (
    <ProductScene f={f} dur={S.nidhi.dur} step="06" eyebrow="Ask Nidhi" title={["Find related matters", "your firm handled."]}
      sub="Describe a new matter in plain words." note={note} appWidth={720} appScale={1.5} push={0.03} origin="50% 30%">
      <div className="nidhi">
        <div className="nidhi-head"><span className="nidhi-dot" style={{ boxShadow: "none" }} />Ask Nidhi <em>Illustrative conversation · sample data</em></div>
        <div className="nidhi-body">
          {f >= 24 && <div className="bubble me" style={{ opacity: q, transform: `translateY(${(1 - q) * 10}px)` }}>{QUESTION}</div>}
          {thinking && <div className="bubble bot typing"><i style={{ opacity: dot(0) }} /><i style={{ opacity: dot(1) }} /><i style={{ opacity: dot(2) }} /></div>}
          {f >= 96 && (
            <div className="bubble bot">
              <div className="rsec" style={{ opacity: sec(0), transform: `translateY(${(1 - sec(0)) * 10}px)` }}><b>1 · Internal case matches</b><p>Matters from your firm’s own records involving ownership and sale-deed disputes, each linked to its case record.</p>
                <ul><li><span className="pill">Internal</span> Selvam vs Thangaraj (Sale Deed) <small>OS/387/2026 · Sub Court, Madurai</small></li><li><span className="pill">Internal</span> Menon Estates vs Kumar Builders <small>CS/142/2026 · Commercial Court, Chennai</small></li></ul></div>
              <div className="rsec" style={{ opacity: sec(1), transform: `translateY(${(1 - sec(1)) * 10}px)` }}><b>2 · External judgments for review</b><p>Potentially relevant judgments with court, citation and source link, for the advocate to read and verify.</p></div>
              <div className="rsec" style={{ opacity: sec(2), transform: `translateY(${(1 - sec(2)) * 10}px)` }}><b>3 · Research summary</b><p>Facts, legal issues and points to investigate further. Supports preparation; it does not replace professional judgment.</p></div>
            </div>
          )}
        </div>
      </div>
    </ProductScene>
  );
}

/* ---------- 9. pillars recap ---------- */
function PillarsScene() {
  const f = useCurrentFrame();
  const P = [
    { n: "01", t: "Firm intelligence", d: "Dashboard, sites, statuses and team." },
    { n: "02", t: "Case & hearing control", d: "Cases, assignments, calendar and hearings." },
    { n: "03", t: "AI-assisted research", d: "eCourts search and Ask Nidhi." },
  ];
  return (
    <Exit f={f} dur={S.pillars.dur} len={10}>
      <AbsoluteFill style={{ padding: "0 120px", justifyContent: "center" }}>
        <div style={{ font: "600 72px/1.08 var(--font-serif)", letterSpacing: "-0.02em", color: INK, marginBottom: 72 }}>
          <Line f={f} at={2}>One workspace for the whole firm.</Line>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 40 }}>
          {P.map((p, i) => {
            const s = tw(f, 14 + i * 7, 20);
            return (
              <div key={p.n} style={{ opacity: s, transform: `translateX(${(1 - s) * 40}px)` }}>
                <div style={{ height: 3, background: "#e3e7f1", marginBottom: 30, position: "relative" }}><div style={{ position: "absolute", inset: 0, width: `${tw(f, 20 + i * 7, 30) * 100}%`, background: BLUE }} /></div>
                <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "0.14em", color: BLUE }}>{p.n}</div>
                <div style={{ font: "600 46px/1.1 var(--font-serif)", color: INK, margin: "14px 0 14px" }}>{p.t}</div>
                <div style={{ fontSize: 26, lineHeight: 1.4, color: INK_2, fontWeight: 500 }}>{p.d}</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Exit>
  );
}

/* ---------- 10. end card ---------- */
function EndCard() {
  const f = useCurrentFrame();
  const btn = tw(f, 40, 18);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
      <In f={f} at={14} dy={12}><Wordmark size={34} /></In>
      <div style={{ font: "600 104px/1.06 var(--font-serif)", letterSpacing: "-0.03em", color: "#fff", marginTop: 40 }}>
        <Line f={f} at={20}>Your entire law firm.</Line>
        <Line f={f} at={28} style={{ color: BLUE_ON_NAVY }}>One clear view.</Line>
      </div>
      <div style={{ marginTop: 64, opacity: btn, transform: `translateY(${(1 - btn) * 16}px)` }}>
        <div style={{ display: "inline-block", background: "#fff", color: NAVY, fontSize: 32, fontWeight: 800, padding: "24px 48px", borderRadius: 14 }}>Book a live demo</div>
      </div>
      <In f={f} at={60} dy={0}>
        <div style={{ marginTop: 56, fontSize: 20, color: "#7f8bb8", fontWeight: 500 }}>Legal practice management for Indian law firms · Product screens use sample data</div>
      </In>
    </AbsoluteFill>
  );
}

/* ---------- background + persistent labels ---------- */
function Backdrop() {
  const f = useCurrentFrame();
  const lightIn = tw(f, S.dash.from - 6, 26); // light panel rises over navy
  const navyIn = tw(f, S.end.from, 22); // navy rises back for the end card
  return (
    <AbsoluteFill style={{ background: NAVY }}>
      <AbsoluteFill style={{ background: LIGHT, clipPath: `inset(${(1 - lightIn) * 100}% 0 0 0)` }} />
      <AbsoluteFill style={{ background: NAVY, clipPath: `inset(${(1 - navyIn) * 100}% 0 0 0)` }} />
    </AbsoluteFill>
  );
}
function Chrome() {
  const f = useCurrentFrame();
  const on = tw(f, S.dash.from + 10, 20) * (1 - twIn(f, S.pillars.from - 10, 10));
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: on }}>
      <div style={{ position: "absolute", left: 120, top: 64 }}><Wordmark size={22} color={NAVY_2} /></div>
      <div style={{ position: "absolute", left: 120, bottom: 56, fontSize: 18, fontWeight: 600, color: "#8089a3" }}>Sample data · fictional firm</div>
    </AbsoluteFill>
  );
}

const SCENE_ORDER: (keyof typeof S)[] = ["cold", "title", "dash", "cal", "cases", "team", "ecourts", "nidhi", "pillars", "end"];

/** vo: optional list of 10 booleans; when true, audio/vo-NN.wav plays at that scene's start + 0.2 s (see render.mjs). */
export function LawsomeFilm({ vo = [] }: { vo?: boolean[] }) {
  const seq = (k: keyof typeof S, node: ReactNode) => {
    const i = SCENE_ORDER.indexOf(k);
    return (
      <Sequence from={S[k].from} durationInFrames={S[k].dur}>
        {node}
        {vo[i] && (<Sequence from={6}><Audio src={staticFile(`vo-${String(i + 1).padStart(2, "0")}.wav`)} /></Sequence>)}
      </Sequence>
    );
  };
  return (
    <AbsoluteFill style={{ fontFamily: "var(--font-sans)", color: INK }}>
      <Backdrop />
      {seq("cold", <ColdOpen />)}
      {seq("title", <TitleCard />)}
      {seq("dash", <DashboardScene />)}
      {seq("cal", <CalendarScene />)}
      {seq("cases", <CasesScene />)}
      {seq("team", <TeamScene />)}
      {seq("ecourts", <ECourtsScene />)}
      {seq("nidhi", <NidhiScene />)}
      {seq("pillars", <PillarsScene />)}
      {seq("end", <EndCard />)}
      <Chrome />
    </AbsoluteFill>
  );
}
