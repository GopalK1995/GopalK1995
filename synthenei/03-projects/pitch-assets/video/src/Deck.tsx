// Static deck exports: each LAWSOME screen on its own, final state, on a neutral background.
import React from "react";
import { AbsoluteFill } from "remotion";
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
import { DashboardScreen, CalendarScreen, HearingsScreen, CasesScreen, TeamScreen, SitesScreen, ECourtsScreen } from "./landing/Screens";

const QUESTION = "We have received a new property dispute involving a disagreement over ownership and a registered sale deed. Find relevant cases already handled by our firm and identify potentially relevant external judgments for further review.";
function NidhiStatic() {
  return (
    <div className="nidhi">
      <div className="nidhi-head"><span className="nidhi-dot" />Ask Nidhi <em>Illustrative conversation · sample data</em></div>
      <div className="nidhi-body">
        <div className="bubble me">{QUESTION}</div>
        <div className="bubble bot">
          <div className="rsec"><b>1 · Internal case matches</b><p>Matters from your firm’s own records involving ownership and sale-deed disputes, each linked to its case record.</p>
            <ul><li><span className="pill">Internal</span> Selvam vs Thangaraj (Sale Deed) <small>OS/387/2026 · Sub Court, Madurai</small></li><li><span className="pill">Internal</span> Menon Estates vs Kumar Builders <small>CS/142/2026 · Commercial Court, Chennai</small></li></ul></div>
          <div className="rsec"><b>2 · External judgments for review</b><p>Potentially relevant judgments with court, citation and source link, for the advocate to read and verify.</p></div>
          <div className="rsec"><b>3 · Research summary</b><p>Facts, legal issues and points to investigate further. Supports preparation; it does not replace professional judgment.</p></div>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <div style={{ background: "var(--c-navy-900)", color: "#fff", borderRadius: 20, padding: "64px 72px 0", width: 1200, overflow: "hidden" }}>
      <div style={{ fontWeight: 800, letterSpacing: "0.14em", fontSize: 17 }}>LAWS<span style={{ color: "#3b61e8" }}>O</span>ME</div>
      <div style={{ marginTop: 44, fontSize: 12, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: "#9db3ff" }}>LAWSOME · Legal Practice Management</div>
      <h1 style={{ font: "600 60px/1.08 var(--font-serif)", letterSpacing: "-0.02em", margin: "16px 0" }}>Your entire law firm. <span style={{ color: "#9db3ff" }}>One clear view.</span></h1>
      <p style={{ fontSize: 18, lineHeight: 1.6, color: "#c4cdee", maxWidth: 760 }}>Manage cases, hearings, calendars, teams and court information in one connected workspace. Give leadership the visibility to stay in control and lawyers the tools to manage their matters more effectively.</p>
      <div style={{ display: "flex", gap: 12, marginTop: 28 }}>
        <span style={{ background: "#2547d0", padding: "14px 22px", borderRadius: 12, fontWeight: 700, fontSize: 15 }}>Book a Live Demo</span>
        <span style={{ border: "1px solid rgba(255,255,255,.28)", padding: "14px 22px", borderRadius: 12, fontWeight: 700, fontSize: 15 }}>Explore the Platform</span>
      </div>
      <div style={{ marginTop: 48, transform: "translateY(24px)" }}><DashboardScreen /></div>
    </div>
  );
}

export const DECK: Record<string, { w: number; node: React.ReactElement }> = {
  "00-hero": { w: 1200, node: <Hero /> },
  "01-dashboard": { w: 900, node: <DashboardScreen /> },
  "02-calendar": { w: 900, node: <CalendarScreen /> },
  "03-hearings": { w: 900, node: <HearingsScreen /> },
  "04-cases": { w: 960, node: <CasesScreen /> },
  "05-sites": { w: 900, node: <SitesScreen /> },
  "06-team": { w: 900, node: <TeamScreen /> },
  "07-ecourts": { w: 900, node: <ECourtsScreen /> },
  "08-ask-nidhi": { w: 720, node: <NidhiStatic /> },
};

export function DeckStill({ id }: { id: string }) {
  const d = DECK[id];
  return (
    <AbsoluteFill style={{ background: "#f6f7fb", fontFamily: "var(--font-sans)", color: "#0f172a", lineHeight: 1.5 }}>
      <div style={{ position: "absolute", left: 64, top: 64, width: d.w }}>
        {d.node}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7390", background: "#fff", border: "1px solid #e3e7f1", borderRadius: 99, padding: "3px 10px" }}>Sample data · fictional firm</span>
        </div>
      </div>
    </AbsoluteFill>
  );
}
