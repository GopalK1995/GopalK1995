"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export const NAV = [
  { group: "Overview", items: [{ href: "/", label: "Funnel overview" }, { href: "/pipeline", label: "Pipeline" }] },
  { group: "People", items: [{ href: "/leads", label: "Leads" }, { href: "/tasks", label: "Tasks & follow-ups" }, { href: "/audience", label: "Audience / ICP" }] },
  { group: "Marketing", items: [{ href: "/campaigns", label: "Campaigns" }, { href: "/channels", label: "Channels & attribution" }, { href: "/traffic", label: "GA4 traffic" }] },
  { group: "System", items: [{ href: "/integrations", label: "Integrations" }, { href: "/data-health", label: "Data & backup" }, { href: "/settings", label: "Settings & privacy" }] },
];

export default function Sidebar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (h: string) => (h === "/" ? path === "/" : path === h || path.startsWith(h + "/"));
  return (
    <>
      <div className="topbar"><span className="brand" style={{ padding: 0 }}>LAW<i>SOME</i></span><button type="button" aria-expanded={open} aria-controls="side-nav" onClick={() => setOpen(!open)}>{open ? "Close" : "Menu"}</button></div>
      <aside id="side-nav" className={`sidebar${open ? " open" : ""}`} aria-label="Primary">
        <div className="brand">LAW<i>SOME</i><small>Growth CRM</small></div>
        {NAV.map((g) => (
          <nav className="nav-group" key={g.group} aria-label={g.group}>
            <div className="nav-label">{g.group}</div>
            {g.items.map((i) => <Link key={i.href} href={i.href} className="nav-link" aria-current={active(i.href) ? "page" : undefined} onClick={() => setOpen(false)}>{i.label}</Link>)}
          </nav>
        ))}
      </aside>
    </>
  );
}
