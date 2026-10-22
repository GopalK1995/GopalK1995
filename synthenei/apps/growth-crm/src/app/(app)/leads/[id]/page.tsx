import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock, Mail, MessageCircle, Phone } from "lucide-react";
import { pageCtx, maskName } from "@/lib/data/context";
import { CHANNEL_LABEL, SLA_MINUTES } from "@/lib/data/metrics";
import { accessFor, ROLE_LABEL } from "@/lib/auth/roles";
import { dayKey, fmtDate, fmtDateY, fmtTime, inr, minsToHuman, relTime } from "@/lib/format";
import type { Activity, ActivityKind, Lead } from "@/lib/data/types";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Dl, PageHeader } from "@/components/ui/misc";
import { ChannelMark, DealStageBadge, LeadStageBadge } from "@/components/ui/domain";
import { cn } from "@/lib/utils";
import { vocabFor, type Vocab } from "@/lib/vertical";
import { DAY, isOpenLead, ownsOrManages, shortCity } from "../_lib/sales";
import { ScoreWithFactors } from "../_components/leads-table";
import { LeadActions } from "./_components/lead-actions";
import { Timeline, type TimelineCat, type TimelineItem } from "./_components/timeline";
import { AiPanel, type Suggestion } from "./_components/ai-panel";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { active } = await pageCtx();
  return { title: vocabFor(active.tenant).ld.metaTitle((await params).id) };
}

const CAT: Record<ActivityKind, TimelineCat> = {
  page_view: "web", form_submit: "web", ad_click: "web", linkedin: "web", email_open: "email", email_click: "email", email_sent: "email", proposal_sent: "email",
  whatsapp_in: "whatsapp", whatsapp_out: "whatsapp", call: "call", demo_booked: "meeting", demo_done: "meeting", stage_change: "system", note: "system",
};
const INBOUND = new Set<ActivityKind>(["whatsapp_in", "form_submit", "email_click"]);

/** Rule-based next best action from a fixed list (spec 9): call, WhatsApp template, email, schedule demo, send proposal, nurture. */
function nextBest(l: Lead, now: string, consentWa: boolean, lastDemoDone: Activity | undefined, v: Vocab): Suggestion {
  if (!isOpenLead(l)) return null;
  const n = v.ld.nextBest;
  const nowMs = new Date(now).getTime();
  const tomorrow = fmtDate(new Date(nowMs + DAY).toISOString());
  const top = [...l.scoreFactors].sort((a, b) => b.points - a.points).slice(0, 2).map((f) => `${f.label} ${f.points > 0 ? "+" : ""}${f.points}`);
  const quiet = Math.round((nowMs - new Date(l.lastTouchAt).getTime()) / DAY);
  const intent = l.scoreFactors.find((f) => f.label === "Pricing page visit" || f.label === "Demo page 3+ visits");
  switch (l.stage) {
    case "new":
      return { action: n.newCall, reason: l.firstResponseMins === null ? n.newNoTouch(relTime(l.createdAt, now), (nowMs - new Date(l.createdAt).getTime()) / 60e3 > SLA_MINUTES) : n.newTouched, due: "Today", factors: top };
    case "contacted":
      return consentWa
        ? { action: n.contactedWa, reason: `${quiet ? `Last touch ${quiet} day${quiet > 1 ? "s" : ""} ago` : "Touched today"}; WhatsApp consent is on record${intent ? " and they viewed pricing" : ""}.`, due: tomorrow, factors: top }
        : { action: n.contactedCall, reason: `${n.noWa} ${intent ? intent.detail + "." : ""}`, due: tomorrow, factors: top };
    case "qualified":
      return { action: n.qualifiedAct, reason: n.qualifiedWhy, due: tomorrow, factors: top };
    case "demo_booked":
      return { action: consentWa ? n.bookedWa : n.bookedMail, reason: n.bookedWhy, due: tomorrow, factors: top };
    case "demo_done": {
      const since = lastDemoDone ? Math.round((nowMs - new Date(lastDemoDone.at).getTime()) / DAY) : null;
      return { action: n.doneAct, reason: n.doneWhy(since !== null ? ` ${since} day${since === 1 ? "" : "s"} ago (${fmtDate(lastDemoDone!.at)})` : "", !!intent), due: since !== null && since > 3 ? "Today" : tomorrow, factors: top };
    }
    case "proposal":
      return { action: n.propAct, reason: n.propWhy(quiet), due: quiet > 5 ? "Today" : tomorrow, factors: top };
    default:
      return { action: n.defAct, reason: n.defWhy, due: tomorrow, factors: top };
  }
}

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ds, now, role, session, masked, active } = await pageCtx();
  const v = vocabFor(active.tenant), ld = v.ld, hosp = v.id === "hospitality";
  const lead = await ds.lead(id);
  if (!lead) notFound();

  // Own-only for reps (spec 10.2): 403 that names the reason, never another rep's data.
  if (role === "sales_rep" && lead.ownerId !== session.uid) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-md border border-line bg-surface p-6 shadow-1">
        <Lock className="size-5 text-ink-3" aria-hidden />
        <h1 className="mt-3 text-[18px] font-semibold">{ld.otherRepTitle}</h1>
        <p className="mt-1 text-[13px] text-ink-2">{ld.otherRepBody}</p>
        <Link href="/leads" className="mt-5 inline-flex h-9 items-center rounded-sm bg-accent px-4 text-[13px] font-medium text-accent-ink hover:bg-accent-strong">{ld.backToMine}</Link>
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
  const firm = account?.name ?? ld.unknownFirm;
  const sizeLabel = account ? v.partySize[account.size] : "";

  const header = (
    <PageHeader
      eyebrow={<Link href="/leads" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="size-3.5" aria-hidden />{ld.crumb(lead.id)}</Link>}
      title={name}
      sub={<>
        {lead.title} {ld.subAt} {account && !masked ? <Link href={`/accounts/${account.id}`} className="font-medium text-ink hover:text-accent">{firm}</Link> : firm}
        {" · "}{ld.district(account?.district ?? shortCity(lead.city))}
      </>}>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <LeadStageBadge stage={lead.stage} />
        <ScoreWithFactors score={lead.score} factors={[...lead.scoreFactors].sort((a, b) => b.points - a.points)} />
        {owner ? <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2"><Avatar name={owner.name} size={20} />{owner.name}</span> : <Badge tone="warn">Unassigned</Badge>}
        {!masked && <>
          <Badge tone={lead.consent.followup ? "success" : "outline"}>{ld.followUp} {lead.consent.followup ? "yes" : "no"}</Badge>
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
            <CardHeader title={ld.maskedCard} />
            <CardBody><Dl items={ld.maskedRows(firm, account?.district ?? "Unknown", sizeLabel, (hosp ? account?.roomsOfInterest?.join(", ") : account?.courts.join(", ")) ?? "Unknown", CHANNEL_LABEL[lead.channel], account ? account.lawyers : null)} /></CardBody>
          </Card>
          <Card>
            <CardHeader title="Why contact details and the timeline are hidden" />
            <CardBody className="text-[13px] leading-5 text-ink-2">{ld.maskedNote(v.role[role])}</CardBody>
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
      title: `${m.from === "lead" ? `${lead.name.split(" ")[0]} replied` : "Sent"} on ${c.via === "instagram" ? "Instagram" : c.via === "phone" ? "phone" : c.channel === "whatsapp" ? "WhatsApp" : c.channel === "email" ? "email" : "LinkedIn"}${m.status ? ` · ${m.status}` : ""}`,
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
  const suggestion = nextBest(lead, now, lead.consent.whatsapp, lastDemoDone, v);
  const inbound = raw.filter((r) => r.inbound).sort((a, b) => b.at.localeCompare(a.at))[0];
  const summary = [
    ld.summaryA(lead.title, hosp ? sizeLabel : account?.size ?? "", account?.lawyers ?? "?", account?.district ?? lead.city, hosp ? v.leadStage[lead.stage] : v.leadStage[lead.stage].toLowerCase(), CHANNEL_LABEL[lead.channel], relTime(lead.createdAt, now)),
    ...(lead.stay ? [`Stay: ${fmtDate(lead.stay.checkIn + "T06:00:00Z")}, ${lead.stay.nights} nights, ${lead.stay.guests} guests, ${lead.stay.room}.`] : []),
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
      {!canWork && accessFor(role, "/leads") === "R" && <p className="mb-5 text-[12px] text-ink-3">{ld.readOnly(v.role[role])}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Centre: timeline */}
        <Card className="order-2 lg:order-none lg:col-span-5 lg:col-start-4 lg:row-start-1">
          <CardHeader title="Activity timeline" sub="Calls, WhatsApp, email, meetings and web visits, newest first" />
          <CardBody>
            {!firstTouchDone && canWork && <p className="mb-3 rounded-sm border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] text-warn-ink">{ld.firstTouchWarn(relTime(lead.createdAt, now))}</p>}
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
              <CardHeader title={ld.snapshot} action={<Link href={`/accounts/${account.id}`} className="text-[12px] font-medium text-accent hover:underline">{ld.openAccount}</Link>} />
              <CardBody>
                <Dl items={ld.snapRows({ name: account.name, where: `${account.locality}, ${shortCity(account.city)}`, lawyers: account.lawyers, size: hosp ? sizeLabel : account.size, courts: hosp ? (account.roomsOfInterest ?? []).join(", ") : account.courts.join(", "), practice: hosp ? (account.interests ?? []).join(", ") : account.practiceAreas.join(", "), tier: account.icpTier })} />
              </CardBody>
            </Card>
          )}
        </div>

        {/* Right column */}
        <div className="order-1 space-y-4 lg:order-none lg:col-span-4 lg:col-start-9 lg:row-start-1">
          <Card>
            <CardHeader title={aiOn ? "Suggested next step" : hosp ? "Enquiry score" : "Lead score"} sub={aiOn ? "Draft from the lead's timeline and score" : "Rule-based; weights editable in AI settings"} action={aiOn ? <Badge tone="showcase">Showcase</Badge> : <Badge tone="outline">AI off</Badge>} />
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
          {lead.stay && (
            <Card>
              <CardHeader title="Stay details" sub={lead.stay.flexibleDates ? "Dates are flexible" : "Dates are fixed"} />
              <CardBody>
                <Dl items={[
                  ["Check-in", <span key="ci" className="num">{fmtDateY(lead.stay.checkIn + "T06:00:00Z")}</span>],
                  ["Nights", <span key="n" className="num">{lead.stay.nights}</span>],
                  ["Guests", <span key="g" className="num">{lead.stay.guests}</span>],
                  ["Rooms", <span key="r" className="num">{lead.stay.rooms}</span>],
                  ["Room interest", lead.stay.room],
                  ["Trip type", String(lead.stay.tripType)],
                  ["Guest", lead.stay.origin === "new" ? "New guest" : lead.stay.origin === "repeat" ? "Repeat guest" : "Referral"],
                  ...(lead.stay.occasion ? [["Occasion", lead.stay.occasion] as [string, string]] : []),
                ]} />
              </CardBody>
            </Card>
          )}
          {deal && (
            <Card>
              <CardHeader title={ld.dealCard} action={<Link href="/pipeline" className="text-[12px] font-medium text-accent hover:underline">Pipeline</Link>} />
              <CardBody>
                <Dl items={[
                  ["Stage", <DealStageBadge key="s" stage={deal.stage} />],
                  ...(deal.stay ? [["Check-in", <span key="dci" className="num">{fmtDateY(deal.stay.checkIn + "T06:00:00Z")}</span>] as [string, React.ReactNode], ["Rate per night", <span key="rpn" className="num">{inr(deal.stay.ratePerNight)}</span>] as [string, React.ReactNode], ["Advance", <span key="adv" className="num">{inr(deal.stay.advancePaid)} of {deal.stay.advancePct}%</span>] as [string, React.ReactNode]] : []),
                  ["Value", <span key="v" className="num">{inr(deal.value)}</span>],
                  [ld.seatsRow, <span key="p" className="num">{hosp ? `${deal.seats} ${deal.seats === 1 ? "night" : "nights"}${deal.stay ? ` · ${deal.stay.rooms} ${deal.stay.rooms === 1 ? "room" : "rooms"}` : ""}` : `${deal.seats} · ${deal.plan}`}</span>],
                  ["In stage", <span key="d" className="num">{Math.floor((nowMs - new Date(deal.stageEnteredAt).getTime()) / DAY)} days</span>],
                  [deal.stage === "won" ? ld.wonOn : ld.expectedClose, fmtDateY(deal.wonAt ?? deal.expectedClose)],
                  ...(deal.lostReason ? [["Lost reason", deal.lostReason] as [string, string]] : []),
                ]} />
                <p className="mt-2 text-[12px] text-ink-3">{v.dealStage[deal.stage]} · {deal.name}</p>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title={ld.tasksFor} sub={`${openTasks.length} open`} />
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
