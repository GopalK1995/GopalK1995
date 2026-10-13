import { ShieldAlert } from "lucide-react";
import { pageCtx } from "@/lib/data/context";
import { SETTINGS_TABS } from "@/lib/auth/roles";
import { MEMBERSHIPS, USERS, WORKSPACES, userById } from "@/lib/tenancy";
import { supportEvents } from "@/lib/support-log";
import { DEAL_STAGE_LABEL } from "@/lib/data/metrics";
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
import { EraseButton } from "./_components/privacy-controls";
import type { DealStage } from "@/lib/data/types";

export const metadata = { title: "Settings" };
const LABEL: Record<string, string> = { users: "Users & roles", branding: "White-label branding", pipeline: "Pipeline stages", privacy: "Consent & privacy", audit: "Audit log" };
const DEFAULT_STAGES: [DealStage, number, number | null][] = [["discovery", 10, 14], ["demo_scheduled", 25, 10], ["demo_done", 40, 14], ["proposal", 60, 21], ["negotiation", 80, 21], ["won", 100, null], ["lost", 0, null]];
const PURPOSE: Record<string, string> = { demo_followup: "Demo follow-up", marketing_email: "Marketing email", whatsapp: "WhatsApp" };
const KIND: Record<string, string> = { erasure: "Erasure", withdrawal: "Withdrawal", access: "Access" };
const REQ_STATUS = { open: { tone: "warn", label: "Open" }, in_progress: { tone: "accent", label: "In progress" }, done: { tone: "success", label: "Done" } } as const;

type SP = { tab?: string; q?: string; actor?: string; kind?: string };

export default async function Settings({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ds, now, role, active, session } = await pageCtx();
  const allowed = SETTINGS_TABS[role];
  const tab = allowed.includes(sp.tab ?? "") ? sp.tab! : allowed[0];
  const tenantWs = WORKSPACES.filter((w) => w.tenantId === active.tenant.id);

  return (
    <>
      <PageHeader eyebrow={`${active.tenant.name} · ${active.ws.name}`} title="Settings"
        sub="Workspace settings apply to this workspace only. Branding applies to the whole tenant." />
      {!allowed.length ? <Empty title="No settings for your role in this workspace." /> : (
        <>
          <TabBar tabs={allowed.map((v) => ({ value: v, label: LABEL[v] ?? v }))} current={tab} />
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="outline-none">
            {tab === "users" && <UsersTab wsName={active.ws.name} tenantName={active.tenant.name} rows={members(active.ws.id, now)} />}
            {tab === "branding" && (
              <BrandingTab tenantName={active.tenant.name} workspaceCount={tenantWs.length} defaultHue={active.tenant.hue}
                primaryOwnerName={userById(active.tenant.primaryOwnerId)?.name ?? "the primary owner"} />
            )}
            {tab === "pipeline" && (
              <PipelineTab wsName={active.ws.name}
                initial={DEFAULT_STAGES.map(([key, probability, maxDays]): Stage => ({ key, label: DEAL_STAGE_LABEL[key], probability, maxDays, terminal: key === "won" ? "won" : key === "lost" ? "lost" : undefined }))} />
            )}
            {tab === "privacy" && <Privacy q={sp.q} />}
            {tab === "audit" && <Audit actor={sp.actor} kind={sp.kind} owner={role === "owner"} />}
          </div>
        </>
      )}
    </>
  );

  async function Privacy({ q }: { q?: string }) {
    const [requests, consent, leads] = await Promise.all([ds.privacyRequests(), ds.consent(), ds.leads()]);
    const nameOf = (id: string) => leads.find((l) => l.id === id)?.name ?? "Erased lead";
    const query = (q ?? "").trim().toLowerCase();
    const log = consent.filter((c) => !query || nameOf(c.leadId).toLowerCase().includes(query) || c.leadId.toLowerCase().includes(query)).slice(0, 25);
    const withdrawn30 = consent.filter((c) => c.action === "withdrawn" && new Date(now).getTime() - new Date(c.at).getTime() < 30 * 864e5).length;
    return (
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-12">
          <CardHeader title="Requests" sub="DPDP Act requests from data principals. Due 30 days after receipt. Erasure is Owner-only and never available in a support session." />
          <DataTable rows={requests} rowKey={(r) => r.id} minWidth={820} caption="Privacy requests"
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
        </Card>
        <Card className="lg:col-span-8">
          <CardHeader title="Consent log" sub={`Append-only. ${consent.length} entries; ${withdrawn30} withdrawals in the last 30 days.`} />
          <div className="px-4 pb-3 sm:px-5"><FilterBar search="Search subject or lead id" /></div>
          <DataTable rows={log} rowKey={(r) => r.id} minWidth={720} caption="Consent log" empty="No consent entries match." emptyHint="Clear the search to see all entries."
            columns={[
              { key: "s", header: "Subject", mobile: "title", cell: (r) => nameOf(r.leadId) },
              { key: "p", header: "Purpose", mobile: "fact", cell: (r) => PURPOSE[r.purpose] },
              { key: "a", header: "Action", mobile: "action", cell: (r) => <Badge tone={r.action === "granted" ? "success" : "warn"}>{r.action === "granted" ? "Granted" : "Withdrawn"}</Badge> },
              { key: "v", header: "Notice", cell: (r) => <span className="font-mono text-[12px] text-ink-2">{r.noticeVersion}</span> },
              { key: "via", header: "Captured via", cell: (r) => <span className="text-ink-2">{r.via}</span> },
              { key: "at", header: "When", mobile: "fact", cell: (r) => <span className="num text-ink-2">{fmtDateY(r.at)}</span> },
            ]} />
        </Card>
        <Card className="lg:col-span-4">
          <CardHeader title="Retention" />
          <CardBody>
            <dl className="flex flex-col gap-3 text-[13px]">
              <div><dt className="text-ink-3">Disqualified leads</dt><dd className="text-ink">Purged after 12 months</dd></div>
              <div><dt className="text-ink-3">Privacy notice</dt><dd className="text-ink">Version v1.3, Tamil and English</dd></div>
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
