import { CtaLink } from "@/components/CtaLink";
import { LeadForm } from "@/components/LeadForm";
import { AskNidhi } from "@/components/AskNidhi";
import { Tour } from "@/components/Tour";
import { ConsentBanner } from "@/components/ConsentBanner";
import { StickyCta } from "@/components/StickyCta";
import { DashboardScreen, CalendarScreen, HearingsScreen, CasesScreen, TeamScreen, SitesScreen, ECourtsScreen } from "@/components/screens/Screens";

const Head = ({ eyebrow, title, body, msg }: { eyebrow: string; title: string; body: string; msg: string }) => (
  <div className="sec-head"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{body}</p><span className="msg">{msg}</span></div>
);

export default function Page() {
  const slides = [
    { key: "dash", label: "Dashboard", caption: "Leadership sees case volumes, status, hearings, growth and sites from one screen.", node: <DashboardScreen /> },
    { key: "cal", label: "Calendar", caption: "Hearings, tasks and notes together — everyone sees what is coming.", node: <CalendarScreen /> },
    { key: "cases", label: "Cases", caption: "Filter by site or status, see who owns each matter, and catch missing hearing dates.", node: <CasesScreen /> },
    { key: "team", label: "Team & sites", caption: "One firm-wide structure with visibility into every site and lawyer.", node: <TeamScreen /> },
    { key: "ecourts", label: "eCourts", caption: "Search court records by CNR, advocate, case number or party name.", node: <ECourtsScreen /> },
  ];
  return (
    <>
      <header className="nav"><div className="wrap nav-in">
        <a className="logo" href="#top">LAWS<i>O</i>ME</a>
        <nav className="nav-links" aria-label="Sections"><a href="#visibility">Visibility</a><a href="#hearings">Hearings</a><a href="#cases">Cases</a><a href="#team">Team</a><a href="#ecourts">eCourts</a><a href="#nidhi">Ask Nidhi</a></nav>
        <CtaLink where="nav" className="btn btn-primary">Book a Live Demo</CtaLink>
      </div></header>

      <main id="top">
        <section className="hero"><div className="wrap">
          <div className="hero-grid"><div>
            <span className="eyebrow">LAWSOME · Legal Practice Management</span>
            <h1>Your entire law firm. <em>One clear view.</em></h1>
            <p className="lead">Manage cases, hearings, calendars, teams and court information in one connected workspace. Give leadership the visibility to stay in control and lawyers the tools to manage their matters more effectively.</p>
            <div className="cta-row"><CtaLink where="hero">Book a Live Demo</CtaLink><CtaLink where="hero-explore" href="#tour" className="btn btn-ghost">Explore the Platform</CtaLink></div>
            <div className="trust"><span>Firm-wide visibility</span><span>Multi-site, multi-user</span><span>eCourts workflows</span><span>AI-assisted research</span></div>
          </div></div>
          <div className="hero-shot"><DashboardScreen /></div>
        </div></section>

        <div className="wrap"><div className="pillars">
          <div className="pillar"><b>Pillar 1</b><h3>See everything that matters</h3><p>A consolidated view of cases, hearings, sites and team activity.</p></div>
          <div className="pillar"><b>Pillar 2</b><h3>Stay ahead of every matter</h3><p>Organise schedules, track assignments and identify missing hearing dates.</p></div>
          <div className="pillar"><b>Pillar 3</b><h3>Work with greater context</h3><p>Search court records and use Ask Nidhi to explore relevant case information.</p></div>
        </div></div>

        <section className="block" id="tour"><div className="wrap">
          <Head eyebrow="Guided tour" title="See LAWSOME in about a minute." body="A quick walkthrough of the workspace — pause or jump to any screen." msg="Sample data shown for illustration" />
          <Tour slides={slides} />
        </div></section>

        <section className="block alt" id="visibility"><div className="wrap split">
          <div className="copy"><Head eyebrow="01 · Firm intelligence" title="One dashboard. Complete visibility." body="Total cases, upcoming hearings, resolved matters, team size, case statuses, incoming case trends and site-level visibility — together." msg="Know what is happening across your firm without chasing updates." />
            <ul className="points"><li>Case volumes and status distribution at a glance</li><li>Upcoming hearings across every site</li><li>Incoming-case growth trend (YTD, 6M, 1Y)</li></ul></div>
          <DashboardScreen />
        </div></section>

        <section className="block" id="hearings"><div className="wrap">
          <Head eyebrow="02 · Case and hearing control" title="Every hearing. Every task. In view." body="Hearings, tasks and notes in one monthly calendar, backed by a site-level hearing list." msg="Bring legal schedules and follow-ups into one organised view." />
          <div className="stack"><CalendarScreen /><HearingsScreen /></div>
        </div></section>

        <section className="block alt" id="cases"><div className="wrap split rev">
          <div className="copy"><Head eyebrow="03 · Case control" title="Every matter, accountable and traceable." body="Search and filter by site, status or assignee. See the next hearing date for each matter — and spot the ones with no date yet." msg="Make case ownership and next steps visible." />
            <ul className="points"><li>Search by title, case number or site</li><li>Assigned lawyer and next hearing on every row</li><li>“Hearing date missing” flags what needs attention</li></ul></div>
          <CasesScreen />
        </div></section>

        <section className="block" id="team"><div className="wrap">
          <Head eyebrow="04 · Firm intelligence" title="Built for multi-site legal teams." body="Manage offices, lawyer profiles, roles and user administration from one organisation." msg="One firm-wide structure, with visibility into individual sites and team members." />
          <div className="stack"><SitesScreen /><TeamScreen /></div>
        </div></section>

        <section className="block alt" id="ecourts"><div className="wrap split">
          <div className="copy"><Head eyebrow="05 · AI-assisted research" title="Court information, easier to access." body="Search by CNR number, advocate, case number or party name across Supreme Court, High Courts and District Courts — from a dedicated workspace, with saved cases and search history." msg="Search relevant court records from a dedicated workspace." />
            <p className="note">External court-record search is separate from your firm’s internal case database.</p></div>
          <ECourtsScreen />
        </div></section>

        <section className="block" id="nidhi"><div className="wrap split rev">
          <div className="copy"><Head eyebrow="06 · Ask Nidhi" title="Meet Ask Nidhi, your AI legal assistant." body="Describe a new matter. Ask Nidhi helps you find relevant cases your firm has already handled and potentially relevant external judgments to review." msg="Find relevant case context faster and support more informed legal preparation." />
            <p className="note">Ask Nidhi supports legal research. It does not provide legal advice or predict case outcomes; advocates should verify all sources. The conversation shown is illustrative.</p></div>
          <AskNidhi />
        </div></section>

        <section className="final" id="demo"><div className="wrap final-grid">
          <div><span className="eyebrow">Next step</span><h2>Bring your firm’s legal operations into one view.</h2>
            <p className="lead">See a guided walkthrough built around how your firm works — from leadership visibility to hearings, cases and AI-assisted research. Tell us about your firm and we’ll set up a live demo.</p></div>
          <LeadForm />
        </div></section>
      </main>
      <footer className="foot"><div className="wrap"><span>© 2026 LAWSOME · Legal Practice Management</span><span>All product screens use sample data · <a href="/privacy" style={{ textDecoration: "underline" }}>Privacy notice</a></span></div></footer>
      <StickyCta />
      <ConsentBanner />
    </>
  );
}
