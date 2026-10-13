import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock, Mail, MessageCircle, Phone } from "lucide-react";
import { pageCtx, maskName } from "@/lib/data/context";
import { CHANNEL_LABEL, DEAL_STAGE_LABEL, LEAD_STAGE_LABEL, SLA_MINUTES } from "@/lib/data/metrics";
import { accessFor, ROLE_LABEL } from "@/lib/auth/roles";
import { dayKey, fmtDate, fmtDateY, fmtTime, inr, minsToHuman, relTime } from "@/lib/format";
import type { Activity, ActivityKind, Lead } from "@/lib/data/types";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Dl, PageHeader } from "@/components/ui/misc";
import { ChannelMark, DealStageBadge, LeadStageBadge } from "@/components/ui/domain";
import { cn } from "@/lib/utils";
import { DAY, isOpenLead, ownsOrManages, shortCity } from "../_lib/sales";
import { ScoreWithFactors } from "../_components/leads-table";
import { LeadActions } from "./_components/lead-actions";
import { Timeline, type TimelineCat, type TimelineItem } from "./_components/timeline";
import { AiPanel, type Suggestion } from "./_components/ai-panel";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Lead ${(await params).id}` };
}

const CAT: Record<ActivityKind, TimelineCat> = {
  page_view: "web", form_submit: "web", ad_click: "web", linkedin: "web", email_open: "email", email_click: "email", email_sent: "email", proposal_sent: "email",
  whatsapp_in: "whatsapp", whatsapp_out: "whatsapp", call: "call", demo_booked: "meeting", demo_done: "meeting", stage_change: "system", note: "system",
};
const INBOUND = new Set<ActivityKind>(["whatsapp_in", "form_submit", "email_click"]);

/** Rule-based next best action from a fixed list (spec 9): call, WhatsApp template, email, schedule demo, send proposal, nurture. */
function nextBest(l: Lead, now: string, consentWa: boolean, lastDemoDone: Activity | undefined): Suggestion {
  if (!isOpenLead(l)) return null;
  const nowMs = new Date(now).getTime();
  const tomorrow = fmtDate(new Date(nowMs + DAY).toISOString());
  const top = [...l.scoreFactors].sort((a, b) => b.points - a.points).slice(0, 2).map((f) => `${f.label} ${f.points > 0 ? "+" : ""}${f.points}`);
  const quiet = Math.round((nowMs - new Date(l.lastTouchAt).getTime()) / DAY);
  const intent = l.scoreFactors.find((f) => f.label === "Pricing page visit" || f.label === "Demo page 3+ visits");
  switch (l.stage) {
    case "new":
      return { action: "Call now to start the conversation", reason: l.firstResponseMins === null ? `No first touch yet; the lead came in ${relTime(l.createdAt, now)} and the 2-hour SLA ${(nowMs - new Date(l.createdAt).getTime()) / 60e3 > SLA_MINUTES ? "has already passed" : "is still running"}.` : "First touch done; confirm interest and a demo slot.", due: "Today", factors: top };
    case "contacted":
      return consentWa
        ? { action: "Send WhatsApp template demo_invite_ta", reason: `${quiet ? `Last touch ${quiet} day${quiet > 1 ? "s" : ""} ago` : "Touched today"}; WhatsApp consent is on record${intent ? " and they viewed pricing" : ""}.`, due: tomorrow, factors: top }
        : { action: "Call to book a demo with the partners", reason: `No WhatsApp consent, so a call is the fastest route. ${intent ? intent.detail + "." : ""}`, due: tomorrow, factors: top };
    case "qualified":
      return { action: "Schedule demo", reason: `Qualified but no demo yet. Partners are usually free after 17:30 or on Saturday mornings.`, due: tomorrow, factors: top };
    case "demo_booked":
      return { action: consentWa ? "Send WhatsApp template demo_reminder_en" : "Email demo reminder with the Meet link", reason: "Demo is booked; a reminder the day before cuts no-shows.", due: tomorrow, factors: top };
    case "demo_done": {
      const since = lastDemoDone ? Math.round((nowMs - new Date(lastDemoDone.at).getTime()) / DAY) : null;
      return { action: "Send proposal", reason: `Demo done${since !== null ? ` ${since} day${since === 1 ? "" : "s"} ago (${fmtDate(lastDemoDone!.at)})` : ""}${intent ? "; pricing page visited since" : ""}.`, due: since !== null && since > 3 ? "Today" : tomorrow, factors: top };
    }
    case "proposal":
      return { action: "Call the managing partner to close", reason: `Proposal is with them; last two-way contact ${quiet} day${quiet === 1 ? "" : "s"} ago.`, due: quiet > 5 ? "Today" : tomorrow, factors: top };
    default:
      return { action: "Mark as nurture", reason: "No clear buying signal yet.", due: tomorrow, factors: top };
  }
}

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ds, now, role, session, masked } = await pageCtx();
  const lead = await ds.lead(id);
  if (!lead) notFound();

  // Own-only for reps (spec 10.2): 403 that names the reason, never another rep's data.
  if (role === "sales_rep" && lead.ownerId !== session.uid) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-md border border-line bg-surface p-6 shadow-1">
        <Lock className="size-5 text-ink-3" aria-hidden />
        <h1 className="mt-3 text-[18px] font-semibold">This lead is assigned to another rep.</h1>
        <p className="mt-1 text-[13px] text-ink-2">Sales Reps open only their own leads. Ask your Sales Manager to reassign it if the firm is in your territory.</p>
        <Link href="/leads" className="mt-5 inline-flex h-9 items-center rounded-sm bg-accent px-4 text-[13px] font-medium text-accent-ink hover:bg-accent-strong">Back to my leads</Link>
      </div>
    );
  }

  const [account, team, acts, deals, tasks, convs, campaigns, ai] = await Promise.all([
    ds.account(lead.accountId), ds.team(), ds.activities(lead.id), ds.deals(), ds.tasks(), ds.conversations(), ds.campaigns(), ds.aiSettings(),
  ]);
  const owner = team.find((t) => t.id === lead.ownerId);
  const deal = deals.find((d) => d.leadId === lead.id);
  const campaign = campaigns.find((c) => c.id === lead.campaignId);
  const nowMs = new Date(now).getTime();
  const name = masked ? maskName(lead.name) : lead.name;
  const firm = account?.name ?? "Unknown firm";

  const header = (
    <PageHeader
      eyebrow={<Link href="/leads" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="size-3.5" aria-hidden />Leads · {lead.id}</Link>}
      title={name}
      sub={<>
        {lead.title} at {account && !masked ? <Link href={`/accounts/${account.id}`} className="font-medium text-ink hover:text-accent">{firm}</Link> : firm}
        {" · "}{account?.district ?? shortCity(lead.city)} district
      </>}>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <LeadStageBadge stage={lead.stage} />
        <ScoreWithFactors score={lead.score} factors={[...lead.scoreFactors].sort((a, b) => b.points - a.points)} />
        {owner ? <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2"><Avatar name={owner.name} size={20} />{owner.name}</span> : <Badge tone="warn">Unassigned</Badge>}
        {!masked && <>
          <Badge tone={lead.consent.followup ? "success" : "outline"}>Demo follow-up {lead.consent.followup ? "yes" : "no"}</Badge>
          <Badge tone={lead.consent.marketing ? "success" : "outline"}>Marketing email {lead.consent.marketing ? "yes" : "no"}</Badge>
          <Badge tone={lead.consent.whatsapp ? "success" : "outline"}>WhatsApp {lead.consent.whatsapp ? "yes" : "no"}</Badge>
        </>}
      </div>
    </PageHeader>
  );

  // Viewer: masked profile only. Never phone, email, timeline or messages (spec 10.1).
  if (masked) {
    return (
      <>
        {header}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Firm" />
            <CardBody><Dl items={[["Firm", firm], ["District", account?.district ?? "Unknown"], ["Size", account ? `${account.size} (${account.lawyers} lawyers)` : "Unknown"], ["Courts", account?.courts.join(", ") ?? "Unknown"], ["Source", CHANNEL_LABEL[lead.channel]]]} /></CardBody>
          </Card>
          <Card>
            <CardHeader title="Why contact details and the timeline are hidden" />
            <CardBody className="text-[13px] leading-5 text-ink-2">Your role ({ROLE_LABEL[role]}) reads masked records: initials, firm, district, stage and score. Phone, email, messages and activity stay with the sales team. Ask the Owner if you need full access.</CardBody>
          </Card>
        </div>
      </>
    );
  }

  // Timeline: activities + messages, newest first.
  const lc = convs.filter((c) => c.leadId === lead.id);
  const by = (uid?: string) => (uid ? team.find((t) => t.id === uid)?.name : undefined);
  const raw: Omit<TimelineItem, "when" | "day">[] = [
    ...acts.map((a) => ({ id: a.id, at: a.at, cat: CAT[a.kind], title: a.title, detail: a.detail, by: by(a.byId), inbound: INBOUND.has(a.kind) })),
    ...lc.flatMap((c) => c.messages.map((m) => ({
      id: `${c.id}-${m.id}`, at: m.at, cat: (c.channel === "linkedin" ? "web" : c.channel) as TimelineCat,
      title: `${m.from === "lead" ? `${lead.name.split(" ")[0]} replied` : "Sent"} on ${c.channel === "whatsapp" ? "WhatsApp" : c.channel === "email" ? "email" : "LinkedIn"}${m.status ? ` · ${m.status}` : ""}`,
      detail: m.body, by: m.from === "us" ? by(m.authorId) : undefined, inbound: m.from === "lead",
    }))),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const today = dayKey(now), yday = dayKey(new Date(nowMs - DAY).toISOString());
  const items: TimelineItem[] = raw.map((r) => {
    const d = dayKey(r.at);
    return { ...r, when: `${fmtTime(r.at)} IST`, day: d === today ? "Today" : d === yday ? "Yesterday" : fmtDateY(r.at) };
  });

  const openTasks = tasks.filter((t) => t.leadId === lead.id && t.status === "open").sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const lastDemoDone = acts.filter((a) => a.kind === "demo_done").sort((a, b) => b.at.localeCompare(a.at))[0];
  const aiOn = ai.summaries || ai.nextBestAction; // Off by default per workspace; the Owner turns features on in /ai (spec 9).
  const suggestion = nextBest(lead, now, lead.consent.whatsapp, lastDemoDone);
  const inbound = raw.filter((r) => r.inbound).sort((a, b) => b.at.localeCompare(a.at))[0];
  const summary = [
    `${lead.title} at a ${account?.size ?? ""} firm (${account?.lawyers ?? "?"} lawyers) in ${account?.district ?? lead.city}; ${LEAD_STAGE_LABEL[lead.stage].toLowerCase()} stage, came in via ${CHANNEL_LABEL[lead.channel]} ${relTime(lead.createdAt, now)}.`,
    inbound ? `Last inbound ${relTime(inbound.at, now)}: "${(inbound.detail ?? inbound.title).slice(0, 110)}${(inbound.detail ?? inbound.title).length > 110 ? "…" : ""}"` : `No reply from ${lead.name.split(" ")[0]} yet; ${lead.scoreFactors.find((f) => f.label === "Pricing page visit")?.detail ?? "no pricing-page visits recorded"}.`,
    lead.nextAction ? `Open follow-up: ${lead.nextAction}${lead.nextActionAt ? ` (due ${fmtDate(lead.nextActionAt)}${lead.nextActionAt < now ? ", overdue" : ""})` : ""}.` : "No open follow-up promised.",
  ];
  const span = raw.length ? `${fmtDate(raw[raw.length - 1].at)}–${fmtDate(raw[0].at)}` : "";
  const basedOn = `${raw.length} timeline events${span ? ` (${span})` : ""} and ${lead.scoreFactors.length} score factors`;

  const owners = team.filter((t) => t.role === "sales_rep" || t.role === "sales_manager").map((t) => ({ id: t.id, name: t.name }));
  const tomorrow = dayKey(new Date(nowMs + DAY).toISOString());
  const canWork = ownsOrManages(role, session.uid, lead.ownerId);
  const firstTouchDone = lead.firstResponseMins !== null;

  return (
    <>
      {header}
      {canWork && (
        <div className="mb-5">
          <LeadActions lead={{ id: lead.id, name: lead.name, firm, email: lead.email, consentWa: lead.consent.whatsapp, ownerId: lead.ownerId || null, today, tomorrow }} owners={owners} />
        </div>
      )}
      {!canWork && accessFor(role, "/leads") === "R" && <p className="mb-5 text-[12px] text-ink-3">Read-only for {ROLE_LABEL[role]}: calls, messages and stage changes are made by the sales team.</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Centre: timeline */}
        <Card className="order-2 lg:order-none lg:col-span-5 lg:col-start-4 lg:row-start-1">
          <CardHeader title="Activity timeline" sub="Calls, WhatsApp, email, meetings and web visits, newest first" />
          <CardBody>
            {!firstTouchDone && canWork && <p className="mb-3 rounded-sm border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] text-warn-ink">Log the first touch to start the SLA clock. The lead arrived {relTime(lead.createdAt, now)}.</p>}
            {items.length ? <Timeline items={items} /> : <p className="rounded-md border border-dashed border-line-strong px-4 py-8 text-center text-[13px] text-ink-3">No activity yet. Log the first call to start the timeline.</p>}
          </CardBody>
        </Card>

        {/* Left column */}
        <div className="order-3 space-y-4 lg:order-none lg:col-span-3 lg:col-start-1 lg:row-start-1">
          <Card>
            <CardHeader title="Contact" />
            <CardBody className="space-y-2 text-[13px]">
              <a href={`tel:${lead.phone.replace(/\s/g, "")}`} className="flex min-h-11 items-center gap-2 text-ink hover:text-accent num"><Phone className="size-4 text-ink-3" aria-hidden />{lead.phone}</a>
              <a href={`mailto:${lead.email}`} className="flex min-h-11 items-center gap-2 break-all text-ink hover:text-accent"><Mail className="size-4 shrink-0 text-ink-3" aria-hidden />{lead.email}</a>
              <p className="flex items-center gap-2 text-ink-2"><MessageCircle className="size-4 text-ink-3" aria-hidden />{lead.consent.whatsapp ? "WhatsApp opted in" : "No WhatsApp consent"}</p>
              <Dl className="pt-2" items={[
                ["First response", lead.firstResponseMins === null ? <span className="text-danger">Not yet</span> : <span className={cn("num", lead.firstResponseMins > SLA_MINUTES && "text-danger")}>{minsToHuman(lead.firstResponseMins)}{lead.firstResponseMins > SLA_MINUTES ? " (SLA missed)" : ""}</span>],
                ["Consent", `${fmtDate(lead.consent.at)}, notice ${lead.consent.noticeVersion}`],
              ]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Source" sub="First touch vs last touch" />
            <CardBody>
              <Dl items={[
                ["First touch", <ChannelMark key="f" channel={lead.firstTouch} withLabel />],
                ["Last touch", <ChannelMark key="l" channel={lead.lastTouch} withLabel />],
                ["Campaign", campaign ? <Link key="c" href={`/campaigns/${campaign.id}`} className="hover:text-accent">{campaign.name}</Link> : <span className="text-ink-3">None (untagged)</span>],
                ["UTM", <span key="u" className="font-mono text-[12px] break-all">{[lead.utm.source, lead.utm.medium, lead.utm.campaign ?? "—"].join(" / ")}</span>],
                ["Created", `${fmtDateY(lead.createdAt)}, ${fmtTime(lead.createdAt)}`],
              ]} />
            </CardBody>
          </Card>
          {account && (
            <Card>
              <CardHeader title="Firm snapshot" action={<Link href={`/accounts/${account.id}`} className="text-[12px] font-medium text-accent hover:underline">Open firm</Link>} />
              <CardBody>
                <Dl items={[
                  ["Firm", account.name], ["Location", `${account.locality}, ${shortCity(account.city)}`], ["Lawyers", <span key="n" className="num">{account.lawyers} ({account.size})</span>],
                  ["Courts", account.courts.join(", ")], ["Practice", account.practiceAreas.join(", ")], ["ICP tier", account.icpTier],
                ]} />
              </CardBody>
            </Card>
          )}
        </div>

        {/* Right column */}
        <div className="order-1 space-y-4 lg:order-none lg:col-span-4 lg:col-start-9 lg:row-start-1">
          <Card>
            <CardHeader title={aiOn ? "Suggested next step" : "Lead score"} sub={aiOn ? "Draft from the lead's timeline and score" : "Rule-based; weights editable in AI settings"} action={aiOn ? <Badge tone="showcase">Showcase</Badge> : <Badge tone="outline">AI off</Badge>} />
            <CardBody>
              {aiOn ? <AiPanel leadId={lead.id} summary={ai.summaries ? summary : []} suggestion={canWork && ai.nextBestAction ? suggestion : null} basedOn={basedOn} />
                : <div className="space-y-3">
                    <p className="text-[13px] leading-5 text-ink-2">Summaries and next-best-action are off for this workspace. The Owner turns them on in <Link href="/ai" className="text-accent hover:underline">AI settings</Link> after ticking the data checklist.</p>
                    <div>
                      <h3 className="mb-1.5 text-[12px] font-medium text-ink-2">Why the score is {lead.score}</h3>
                      <ul className="space-y-1 text-[12px]">{[...lead.scoreFactors].sort((a, b) => b.points - a.points).map((f) => (
                        <li key={f.label} className="flex justify-between gap-3"><span className="min-w-0 text-ink-2"><span className="text-ink">{f.label}</span> · {f.detail}</span><span className={cn("shrink-0 font-medium num", f.points < 0 ? "text-danger" : "text-ink")}>{f.points > 0 ? "+" : ""}{f.points}</span></li>
                      ))}</ul>
                    </div>
                  </div>}
            </CardBody>
          </Card>
          {deal && (
            <Card>
              <CardHeader title="Open deal" action={<Link href="/pipeline" className="text-[12px] font-medium text-accent hover:underline">Pipeline</Link>} />
              <CardBody>
                <Dl items={[
                  ["Stage", <DealStageBadge key="s" stage={deal.stage} />],
                  ["Value", <span key="v" className="num">{inr(deal.value)}</span>],
                  ["Seats · plan", <span key="p" className="num">{deal.seats} · {deal.plan}</span>],
                  ["In stage", <span key="d" className="num">{Math.floor((nowMs - new Date(deal.stageEnteredAt).getTime()) / DAY)} days</span>],
                  [deal.stage === "won" ? "Won on" : "Expected close", fmtDateY(deal.wonAt ?? deal.expectedClose)],
                  ...(deal.lostReason ? [["Lost reason", deal.lostReason] as [string, string]] : []),
                ]} />
                <p className="mt-2 text-[12px] text-ink-3">{DEAL_STAGE_LABEL[deal.stage]} · {deal.name}</p>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Tasks for this lead" sub={`${openTasks.length} open`} />
            {openTasks.length ? (
              <ul className="divide-y divide-line border-t border-line">
                {openTasks.map((t) => (
                  <li key={t.id} className="px-4 py-2.5 sm:px-5">
                    <p className="text-[13px] text-ink">{t.title}</p>
                    <p className={cn("text-[12px] num", t.dueAt < now ? "font-medium text-danger" : "text-ink-3")}>{t.dueAt < now ? "Overdue · " : ""}{fmtDate(t.dueAt)}, {fmtTime(t.dueAt)}</p>
                  </li>
                ))}
              </ul>
            ) : <CardBody className="text-[13px] text-ink-3">No open tasks. Logging a call with a next-step date creates one.</CardBody>}
          </Card>
        </div>
      </div>
    </>
  );
}
