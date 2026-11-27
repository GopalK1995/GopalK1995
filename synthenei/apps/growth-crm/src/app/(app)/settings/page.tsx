import Link from "next/link";
import { AuditTab } from "./_components/audit-tab";
import { ShieldAlert } from "lucide-react";
import { pageCtx } from "@/lib/data/context";
import { SETTINGS_TABS } from "@/lib/auth/roles";
import { MEMBERSHIPS, USERS, WORKSPACES, userById } from "@/lib/tenancy";
import { supportEvents } from "@/lib/support-log";
import { vocabFor } from "@/lib/vertical";
import { fmtDateTime, fmtDateY, relTime } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Empty, PageHeader } from "@/components/ui/misc";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { cn } from "@/lib/utils";
import { TabBar } from "./_components/tab-bar";
import { UsersTab, type MemberRow } from "./_components/users-tab";
import { BrandingTab } from "./_components/branding-tab";
import { PipelineTab, type Stage } from "./_components/pipeline-tab";
import { ConfigTab } from "./_components/config-tab";
import { EraseButton, PrivacyHubLink } from "./_components/privacy-controls";
import { stageList } from "@/lib/config/types";
import { pageTitle } from "@/i18n/server";
import { scopeName } from "@/lib/workspace-label";
import { settingsLinksFor } from "@/components/shell/nav";
import { dbForRequest } from "@/lib/db/client";
import { decodeConsentCursor, normaliseQuery, pageConsentDb, pageConsentMemory, type ConsentLogPage } from "@/lib/privacy/consent-log";

export const generateMetadata = pageTitle("settings");
const LABEL: Record<string, string> = { users: "Access", branding: "White-label branding", config: "Configuration", pipeline: "Pipeline stages", privacy: "Consent & privacy", audit: "Audit log" };
const VIA: Record<string, string> = { landing_form: "Landing form", cookie_banner: "Cookie banner", manual: "Entered by a team member", request: "Privacy request", whatsapp_optin: "WhatsApp opt-in", import: "Import", integration: "Integration" };
const PURPOSE: Record<string, string> = { demo_followup: "Demo follow-up", marketing_email: "Marketing email", whatsapp: "WhatsApp" };
const KIND: Record<string, string> = { erasure: "Erasure", withdrawal: "Withdrawal", access: "Access" };
const REQ_STATUS = { open: { tone: "warn", label: "Open" }, in_progress: { tone: "accent", label: "In progress" }, done: { tone: "success", label: "Done" } } as const;

type SP = { tab?: string; q?: string; cur?: string; actor?: string; kind?: string };

export default async function Settings({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ds, now, role, active, session, cfg } = await pageCtx();
  const allowed = SETTINGS_TABS[role];
  const tab = allowed.includes(sp.tab ?? "") ? sp.tab! : allowed[0];
  const tenantWs = WORKSPACES.filter((w) => w.tenantId === active.tenant.id);

  return (
    <>
      <PageHeader eyebrow={scopeName(active.tenant.name, active.ws.name)} title="Settings"
        sub="Workspace settings apply to this workspace only. Branding applies to the whole tenant." />
      <nav aria-label="All settings" className="mb-5 rounded-control border border-line bg-surface p-4">
        <h2 className="mb-2 text-[13px] font-semibold text-ink">All settings</h2>
        <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {settingsLinksFor(role, active.tenant).map((l) => <li key={l.href}><Link href={l.href} className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink focus-ring"><l.icon className="size-4 text-ink-3" aria-hidden />{l.label}</Link></li>)}
        </ul>
      </nav>
      {!allowed.length ? <Empty title="No settings for your role in this workspace." /> : (
        <>
          <TabBar tabs={allowed.map((v) => ({ value: v, label: LABEL[v] ?? v }))} current={tab} />
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="focus-ring">
            {tab === "users" && (session.demo ? <UsersTab wsName={active.ws.name} tenantName={active.tenant.name} rows={members(active.ws.id, now)} /> : (
              <Card><CardBody><p className="text-[13px] text-ink-2">Members, roles and teams now live in <Link href="/settings/roles" className="font-medium text-accent underline">Access</Link>.</p></CardBody></Card>
            ))}
            {tab === "branding" && (
              <BrandingTab tenantName={active.tenant.name} workspaceCount={tenantWs.length} defaultHue={active.tenant.hue}
                primaryOwnerName={userById(active.tenant.primaryOwnerId)?.name ?? "the primary owner"} />
            )}
            {tab === "pipeline" && (
              <PipelineTab wsName={active.ws.name}
                initial={stageList(cfg.stages.deal).map((key): Stage => { const s = cfg.stages.deal[key]; return { key, label: s.label, probability: s.probability, maxDays: s.slaHours ? Math.max(1, Math.ceil(s.slaHours / 24)) : null, terminal: s.outcome === "open" ? undefined : s.outcome }; })} />
            )}
            {tab === "privacy" && <Privacy q={sp.q} cur={sp.cur} />}
            {tab === "config" && <ConfigTab />}
            {tab === "audit" && (session.demo ? <Audit actor={sp.actor} kind={sp.kind} owner={role === "owner"} /> : <AuditTab sp={sp} />)}
          </div>
        </>
      )}
    </>
  );

  async function Privacy({ q, cur }: { q?: string; cur?: string }) {
    const demo = session.demo === true;
    const erased = vocabFor(active.tenant).st.erasedLead;
    const query = normaliseQuery(q);
    // Demo reads the in-memory sample; real sessions page the database (keyset, 25 per page, server-side search): never a capped full read.
    let requests: Awaited<ReturnType<typeof ds.privacyRequests>> = [], leads: Awaited<ReturnType<typeof ds.leads>> = [];
    if (demo) [requests, leads] = await Promise.all([ds.privacyRequests(), ds.leads()]);
    const nameOf = (id: string) => leads.find((l) => l.id === id)?.name ?? erased;
    let page: ConsentLogPage | null = null;
    try {
      page = demo
        ? pageConsentMemory(await ds.consent(), new Map(leads.map((l) => [l.id, l.name])), erased, new Date(now).getTime(), { q: query, cursor: cur })
        : await pageConsentDb(await dbForRequest(), active.ws.uuid, erased, new Date(now).getTime(), { q: query, cursor: cur });
    } catch { page = null; }
    const href = (cursor: string | null) => `/settings?tab=privacy${query ? `&q=${encodeURIComponent(query)}` : ""}${cursor ? `&cur=${cursor}` : ""}`;
    const onFirstPage = !decodeConsentCursor(cur, query);
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-12"><PrivacyHubLink /></div>
        <Card className="lg:col-span-12">
          <CardHeader title="Requests" sub="DPDP Act requests from data principals. Due 30 days after receipt. Erasure is Owner-only and never available in a support session." />
          {demo ? (
            <DataTable rows={requests} rowKey={(r) => r.id} minWidth={820} caption="Privacy requests" empty="No privacy requests yet." emptyHint="Requests made on the public privacy page appear here."
              columns={[
                { key: "id", header: "Request", cell: (r) => <span className="font-mono text-[12px] text-ink-3">{r.id}</span> },
                { key: "s", header: "Subject", mobile: "title", cell: (r) => <span className="font-medium">{nameOf(r.leadId)}</span> },
                { key: "k", header: "Type", mobile: "fact", cell: (r) => KIND[r.kind] },
                { key: "rc", header: "Received", cell: (r) => <span className="num">{fmtDateY(r.receivedAt)}</span> },
                { key: "due", header: "Due", mobile: "fact", cell: (r) => {
                  const overdue = r.status !== "done" && r.dueAt < now;
                  return <span className={cn("num", overdue ? "font-medium text-danger" : "text-ink-2")}>{r.status === "done" ? "Closed" : `${overdue ? "Overdue · " : "Due "}${relTime(r.dueAt, now)}`}</span>;
                } },
                { key: "st", header: "Status", cell: (r) => <Badge tone={REQ_STATUS[r.status].tone}>{REQ_STATUS[r.status].label}</Badge> },
                { key: "a", header: <span className="sr-only">Action</span>, mobile: "action", cell: (r) => r.kind === "erasure" && r.status !== "done" ? <EraseButton requestId={r.id} subject={nameOf(r.leadId)} /> : <span className="text-[12px] text-ink-3">{r.status === "done" ? "Completed" : "Handled by Data"}</span> },
              ]} />
          ) : (
            <CardBody><p className="text-[13px] text-ink-2">Requests, due dates and erasure are handled in <Link href="/settings/privacy" className="font-medium text-accent underline">Privacy requests</Link>. Share the public privacy link from there.</p></CardBody>
          )}
        </Card>
        <Card className="lg:col-span-8">
          {!page ? (
            <>
              <CardHeader title="Consent log" sub="Append-only." />
              <CardBody><p role="alert" className="text-[13px] text-danger">The consent log could not be loaded. Reload the page; if it keeps failing, contact support.</p></CardBody>
            </>
          ) : (
            <>
              <CardHeader title="Consent log" sub={`Append-only. ${page.total} ${query ? "matching " : ""}${page.total === 1 ? "entry" : "entries"}; ${page.withdrawn30} withdrawal${page.withdrawn30 === 1 ? "" : "s"} in the last 30 days. Names are shortened; open the record for details.`} />
              <div className="px-4 pb-3 sm:px-5"><FilterBar search="Search by name of the person" /></div>
              {page.searchCapped && <p role="status" className="px-4 pb-3 text-[12px] text-ink-3 sm:px-5">Many people match this search; showing entries for the first 200. Type more of the name to narrow it.</p>}
              <DataTable rows={page.rows} rowKey={(r) => r.id} minWidth={720} caption="Consent log"
                empty={query ? `No consent entries match "${query}".` : "No consent entries yet."}
                emptyHint={query ? "Clear the search to see all entries." : "An entry is added when consent is given or withdrawn: on a form, a WhatsApp opt-in, an import or an unsubscribe."}
                columns={[
                  { key: "s", header: "Subject", mobile: "title", cell: (r) => (r.leadId && r.subject !== erased ? <Link href={`/leads/${r.leadId}`} className="text-accent underline">{r.subject}</Link> : r.subject) },
                  { key: "p", header: "Purpose", mobile: "fact", cell: (r) => PURPOSE[r.purpose] ?? r.purpose },
                  { key: "a", header: "Action", mobile: "action", cell: (r) => <Badge tone={r.action === "granted" ? "success" : "warn"}>{r.action === "granted" ? "Granted" : "Withdrawn"}</Badge> },
                  { key: "v", header: "Notice", cell: (r) => <span className="font-mono text-[12px] text-ink-2">{r.noticeVersion || "—"}</span> },
                  { key: "via", header: "Captured via", cell: (r) => <span className="text-ink-2">{VIA[r.via] ?? r.via}</span> },
                  { key: "at", header: "When", mobile: "fact", cell: (r) => <span className="num text-ink-2">{fmtDateY(r.at)}</span> },
                ]} />
              {(page.nextCursor || !onFirstPage) && (
                <nav aria-label="Consent log pages" className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] sm:px-5" data-testid="consent-pager">
                  {onFirstPage ? <span className="text-ink-3">Newest entries</span> : <Link href={href(null)} className="font-medium text-accent underline">Back to newest</Link>}
                  {page.nextCursor ? <Link href={href(page.nextCursor)} rel="next" className="font-medium text-accent underline">Older entries</Link> : <span className="text-ink-3">End of the log</span>}
                </nav>
              )}
            </>
          )}
        </Card>
        <Card className="lg:col-span-4">
          <CardHeader title="Retention" />
          <CardBody>
            <dl className="flex flex-col gap-3 text-[13px]">
              {demo ? (
                <>
                  <div><dt className="text-ink-3">{vocabFor(active.tenant).st.dqRetention}</dt><dd className="text-ink">Purged after 12 months</dd></div>
                  <div><dt className="text-ink-3">Privacy notice</dt><dd className="text-ink">Version v1.3, Tamil and English (sample)</dd></div>
                </>
              ) : (
                <div><dt className="text-ink-3">Retention rules</dt><dd className="text-ink">Set per record type on the <Link href="/settings/privacy/retention" className="font-medium text-accent underline">Retention page</Link>.</dd></div>
              )}
              <div><dt className="text-ink-3">Withdrawal</dt><dd className="text-ink">Stops the purpose at once; unsubscribe and WhatsApp STOP write here automatically</dd></div>
            </dl>
          </CardBody>
        </Card>
      </div>
    );
  }

  async function Audit({ actor, kind, owner }: { actor?: string; kind?: string; owner: boolean }) {
    const entries = await ds.audit();
    const nameOf = (id: string) => userById(id)?.name ?? id;
    const maskIp = (ip: string) => (owner ? ip : ip.replace(/\.\d+\.\d+$/, ".•.•"));
    const maskPii = (s: string) => (owner ? s : s.replace(/[\w.+-]+@[\w.-]+/g, "[email]").replace(/\+?\d[\d\s-]{8,}\d/g, "[phone]"));
    type Row = { id: string; at: string; actor: string; action: string; target: string; ip: string; support: boolean };
    const rows: Row[] = [
      ...entries.map((e) => ({ id: e.id, at: e.at, actor: nameOf(e.actorId), action: e.action, target: maskPii(e.target), ip: maskIp(e.ip), support: false })),
      ...supportEvents(active.ws.id).map((e) => ({
        id: e.id, at: e.at, actor: `${e.admin} (Synthan)`, support: true, ip: "platform",
        action: e.action === "support_started" ? `Support session started · ${e.mode === "read_write" ? "read-write" : "read-only"}${e.minutes ? `, ${e.minutes} min` : ""}` : "Support session ended",
        target: e.reason ? `Reason: ${e.reason}` : "",
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    const actors = [...new Set(rows.map((r) => r.actor))].sort();
    const shown = rows.filter((r) => (!actor || r.actor === actor) && (!kind || (kind === "support" ? r.support : !r.support)));
    return (
      <Card>
        <CardHeader title="Audit log" sub={`Append-only record of writes in ${active.ws.name}, including support sessions by the platform operator.${owner ? "" : " Personal data and IP addresses are masked for your role."}`} />
        <div className="px-4 pb-3 sm:px-5">
          <FilterBar filters={[
            { key: "actor", label: "Actor", options: actors.map((a) => ({ value: a, label: a })) },
            { key: "kind", label: "Type", options: [{ value: "support", label: "Support sessions" }, { value: "member", label: "Member actions" }] },
          ]} />
        </div>
        <DataTable rows={shown} rowKey={(r) => r.id} minWidth={900} caption="Audit log" empty="No entries match these filters."
          rowClassName={(r) => (r.support ? "bg-warn-soft/40" : "")}
          columns={[
            { key: "at", header: "When", mobile: "fact", cell: (r) => <span className="num text-ink-2" title={`${fmtDateTime(r.at)} IST`}>{fmtDateTime(r.at)}</span> },
            { key: "who", header: "Actor", mobile: "fact", cell: (r) => <span className="inline-flex items-center gap-1.5">{r.support && <ShieldAlert className="size-3.5 text-warn-ink" aria-label="Support session" />}{r.actor}</span> },
            { key: "act", header: "Action", mobile: "title", cell: (r) => <span className="font-medium">{r.action}</span> },
            { key: "tgt", header: "Target", cell: (r) => <span className="block max-w-[360px] truncate text-ink-2" title={r.target}>{r.target}</span> },
            { key: "ip", header: "IP", cell: (r) => <span className="font-mono text-[12px] text-ink-3">{r.ip}</span> },
          ]} />
        <p className="border-t border-line px-4 py-3 text-[12px] text-ink-3 sm:px-5">Signed in as {session.name}. Audit rows cannot be edited or deleted by anyone, including Owners.</p>
      </Card>
    );
  }
}

function members(wsId: string, now: string): MemberRow[] {
  return MEMBERSHIPS.filter((m) => m.workspaceId === wsId).map((m) => {
    const u = USERS.find((x) => x.id === m.userId)!;
    return {
      userId: u.id, name: u.name, email: u.email, role: m.role, status: u.status,
      otherWs: MEMBERSHIPS.filter((x) => x.userId === u.id && x.workspaceId !== wsId).length,
      lastSignIn: u.status === "invited" ? "Not yet" : relTime(u.lastSignIn, now),
    };
  }).sort((a, b) => ["owner", "sales_manager", "marketing", "data", "sales_rep", "viewer"].indexOf(a.role) - ["owner", "sales_manager", "marketing", "data", "sales_rep", "viewer"].indexOf(b.role));
}
