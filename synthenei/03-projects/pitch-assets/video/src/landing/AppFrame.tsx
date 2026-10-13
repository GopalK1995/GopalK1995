import type { ReactNode } from "react";

const NAV = ["Dashboard", "Calendar", "Cases", "Users", "Sites", "Notifications"] as const;
export type NavKey = (typeof NAV)[number] | "eCourts";

export function AppFrame({ active, url, children }: { active: NavKey; url: string; children: ReactNode }) {
  return (
    <div className="app" role="img" aria-label={`LAWSOME ${active} screen with sample data`}>
      <div className="chrome"><i /><i /><i /><span>app.lawsome.in/{url}</span></div>
      <div className="side" aria-hidden>
        <div className="brand">LAWSOME</div>
        <small>FIRM</small>
        {NAV.map((n) => (
          <div key={n} className={`item${n === active ? " on" : ""}`}>{n}</div>
        ))}
        <small>PRACTICE</small>
        <div className={`item${active === "eCourts" ? " on" : ""}`}>eCourts</div>
        <small>SETTINGS</small>
        <div className="item">Settings</div>
      </div>
      <div className="main" aria-hidden>
        <div className="topbar">
          <div className="search">Search cases, users, sites…</div>
          <div className="who"><b>RC</b><span>Raghavan Chambers<small>Organization Admin</small></span></div>
        </div>
        {children}
      </div>
    </div>
  );
}
