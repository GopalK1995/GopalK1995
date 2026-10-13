import { AppFrame } from "./AppFrame";
import {
  firm, stats, statusBars, growth, months, upcomingHearings, sites, cases,
  calendarEvents, hearingsList, team, savedCases,
} from "@/data/demo";

function Growth() {
  const W = 300, H = 110, max = 10;
  const pts = growth.map((v, i) => [(i / (growth.length - 1)) * W, H - (v / max) * H] as const);
  const d = pts.map(([x, y], i) => (i ? `L${x},${y}` : `M${x},${y}`)).join(" ");
  return (
    <svg viewBox={`-6 -8 ${W + 12} ${H + 28}`} width="100%" role="presentation">
      {[0, 5, 10].map((g) => (<line key={g} x1="0" x2={W} y1={H - (g / max) * H} y2={H - (g / max) * H} stroke="#e8ebf4" strokeDasharray="3 3" />))}
      <path d={d} fill="none" stroke="var(--c-blue-600)" strokeWidth="2" strokeLinejoin="round" />
      {pts.map(([x, y], i) => (<circle key={i} cx={x} cy={y} r="2.6" fill="var(--c-blue-600)" />))}
      {months.map((m, i) => (i % 1 === 0 ? <text key={m} x={(i / (months.length - 1)) * W} y={H + 14} fontSize="7" textAnchor="middle" fill="#8a93ad">{m}</text> : null))}
    </svg>
  );
}

export function DashboardScreen() {
  return (
    <AppFrame active="Dashboard" url="organization/dashboard">
      <div className="banner">
        <div><h4>{firm.name}</h4><div className="chips">{firm.tags.map((t, i) => <span key={t} className={`chip${i === 0 ? " fill" : ""}`}>{t}</span>)}<span className="chip">{stats.sites} sites</span></div></div>
        <div className="qa">+ Quick actions</div>
      </div>
      <div className="cards4">
        <div className="c stat"><div className="ico">▤</div><strong>{stats.total}</strong><span>Total cases · {stats.thisMonth} this month</span></div>
        <div className="c stat"><div className="ico">⚖</div><strong>{stats.upcoming}</strong><span>Upcoming hearings</span></div>
        <div className="c stat"><div className="ico">✓</div><strong>{stats.resolved}</strong><span>Resolved cases</span></div>
        <div className="c stat"><div className="ico">☺</div><strong>{stats.team}</strong><span>Lawyers &amp; staff · {stats.sites} sites</span></div>
      </div>
      <div className="cols">
        <div>
          <div className="c"><h5>Cases by status <em>{stats.total - stats.resolved} active matters</em></h5>
            {statusBars.map((s) => (<div className="bar" key={s.label}><div><span>{s.label}</span><span>{s.n}</span></div><i><b style={{ width: `${(s.n / 17) * 100}%`, background: s.color }} /></i></div>))}
          </div>
          <div className="c"><h5>Firm growth – incoming cases <em>YTD</em></h5><Growth /></div>
        </div>
        <div>
          <div className="c"><h5>Upcoming hearings</h5>
            {upcomingHearings.map((h) => (<div className="hear" key={h.title}><div className="dt">{h.d}<small>{h.m}</small></div><div><b>{h.title}</b><span>{h.where}</span></div></div>))}
          </div>
          <div className="c"><h5>Sites</h5>{sites.map((s) => (<div className="hear" key={s.key}><div><b>{s.name}</b><span>{s.where.split(" - ")[0]}</span></div></div>))}</div>
        </div>
      </div>
    </AppFrame>
  );
}

export function CalendarScreen() {
  // October 2026 starts on Thursday. Grid starts Sun 27 Sep.
  const cells = Array.from({ length: 35 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 8, 27 + i));
    const iso = date.toISOString().slice(0, 10);
    return { n: date.getUTCDate(), iso, mut: date.getUTCMonth() !== 9 };
  });
  return (
    <AppFrame active="Calendar" url="organization/calendar">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="page-h"><h4>October 2026</h4></div>
        <div className="legend"><span><i style={{ background: "var(--c-closed)" }} />Hearings</span><span><i style={{ background: "#e08a2f" }} />Tasks</span><span><i style={{ background: "#8a93ad" }} />Notes</span></div>
      </div>
      <div className="cal">
        {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => <div className="dh" key={d}>{d}</div>)}
        {cells.map((c) => (
          <div key={c.iso} className={`d${c.mut ? " mut" : ""}${c.iso === "2026-10-13" ? " today" : ""}`}>
            {c.iso === "2026-10-13" ? <b>{c.n}</b> : c.n}
            {(calendarEvents[c.iso] ?? []).slice(0, 3).map((e, i) => <span key={i} className={`ev ${e.kind}`}>{e.text}</span>)}
          </div>
        ))}
      </div>
    </AppFrame>
  );
}

export function HearingsScreen() {
  return (
    <AppFrame active="Sites" url="sites/egmore-office/hearings">
      <div className="page-h"><h4>Hearings</h4><p>All upcoming and past hearings for this site.</p></div>
      <div className="filters"><span>dd/mm/yyyy</span><span>dd/mm/yyyy</span><span className="s">Filter by court…</span><span>Default sort ▾</span></div>
      <div className="c" style={{ padding: 0 }}>
        <table className="tbl"><thead><tr><th>Date &amp; time</th><th>Case</th><th>Location</th><th>Status</th><th>Assigned</th><th>Notes</th></tr></thead>
          <tbody>{hearingsList.map((h) => (<tr key={h.title}><td>{h.when}</td><td><b>{h.title}</b></td><td>{h.loc}</td><td><span className={`pill${h.status === "Completed" ? " grey" : ""}`}>● {h.status}</span></td><td>{h.who}</td><td>{h.notes}</td></tr>))}</tbody>
        </table>
      </div>
    </AppFrame>
  );
}

const statusClass: Record<string, string> = { Open: "", "In Progress": " amber", "On Hold": " grey" };

export function CasesScreen() {
  return (
    <AppFrame active="Cases" url="organization/cases">
      <div className="filters"><span className="s">Search by title, case number, site…</span><span>All status ▾</span><span>All sites ▾</span><span>All assignees ▾</span></div>
      <div className="c" style={{ padding: 0 }}>
        <table className="tbl"><thead><tr><th>Case</th><th>Case no.</th><th>Next hearing</th><th>Site</th><th>Status</th><th>Assigned to</th></tr></thead>
          <tbody>{cases.map((c) => (
            <tr key={c.ref}>
              <td><b>{c.title}</b><small>{c.ref}</small></td><td>{c.no}</td>
              <td>{c.hearing ?? <span className="miss">⚠ Hearing date missing</span>}</td>
              <td>{c.site}</td><td><span className={`pill${statusClass[c.status] ?? ""}`}>● {c.status}</span></td>
              <td><span className="av">{c.who.split(" ")[1][0]}</span>{c.who}</td>
            </tr>))}
          </tbody>
        </table>
      </div>
    </AppFrame>
  );
}

export function TeamScreen() {
  return (
    <AppFrame active="Users" url="organization/users">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="page-h"><h4>Lawyers</h4><p>Manage all lawyers and staff across your sites.</p></div>
        <div className="btnp">+ Add User</div>
      </div>
      <div className="grid3">
        {team.map((p) => (<div className="c person" key={p.name}><div className="big">{p.initials}</div><div><b>{p.name}</b><span>{p.role}</span><span>⌖ {p.site}</span></div></div>))}
      </div>
    </AppFrame>
  );
}

export function SitesScreen() {
  return (
    <AppFrame active="Sites" url="organization/sites">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="page-h"><h4>Sites</h4><p>Each site has its own cases, lawyers and clients.</p></div>
        <div className="btnp">+ Add Site</div>
      </div>
      <div className="grid3" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
        {sites.map((s) => (<div className="c" key={s.key}><div className="person"><div className="big">{s.name.slice(0, 2).toUpperCase()}</div><div><b>{s.name}</b><span>{s.key}</span></div></div>
          <p style={{ margin: "8px 0", color: "#6b7390" }}>⌖ {s.where}</p>
          <div style={{ display: "flex", gap: 18 }}><div><b style={{ font: "600 18px var(--font-serif)" }}>{s.cases}</b><br />CASES</div><div><b style={{ font: "600 18px var(--font-serif)" }}>{s.staff}</b><br />STAFF</div></div></div>))}
      </div>
    </AppFrame>
  );
}

export function ECourtsScreen() {
  return (
    <AppFrame active="eCourts" url="organization/ecourts">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="page-h"><h4>eCourts</h4><p>Search, track, and manage court cases.</p></div>
        <div className="tabs"><span className="on">Search</span><span>Saved Cases</span><span>History</span><span>Refresh Queue</span></div>
      </div>
      <div className="c">
        <div className="tabs" style={{ marginBottom: 10 }}><span>CNR Number</span><span className="on">Advocate</span><span>Case Number</span><span>Party Name</span></div>
        <div className="seg" style={{ marginBottom: 10 }}><span>Supreme Court</span><span className="on">High Courts</span><span>District Courts</span></div>
        <div className="grid3" style={{ marginBottom: 8 }}>
          <div className="fld">State / UT<span>Tamil Nadu</span></div><div className="fld">High Court<span>Madras High Court</span></div><div className="fld">Bench<span>Principal Bench</span></div>
        </div>
        <div className="row"><div className="seg"><span>Pending</span><span>Disposed</span><span className="on">Both</span></div><div className="fld" style={{ flex: 1 }}>Advocate name<span>Ananya Raghavan</span></div><div className="btnp">Search</div></div>
      </div>
      <div className="c" style={{ padding: 0 }}>
        <table className="tbl"><thead><tr><th>CNR</th><th>Case title</th><th>Court</th><th>Status</th></tr></thead>
          <tbody>{savedCases.map((s) => (<tr key={s.cnr}><td><b>{s.cnr}</b></td><td>{s.title}</td><td>{s.court}</td><td><span className={`pill${s.status === "DISPOSED" ? " ok" : " amber"}`}>● {s.status}</span></td></tr>))}</tbody>
        </table>
      </div>
    </AppFrame>
  );
}
