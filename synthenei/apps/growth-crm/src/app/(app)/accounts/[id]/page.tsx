import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, CalendarCheck2, FileText, Mail, MessageCircle, NotebookPen, Phone, Repeat2, Video, Globe, MapPin } from "lucide-react";
import { pageCtx } from "@/lib/data/context";
import { dayKey, fmtDate, fmtDateY, fmtTime, inr, inrCompact, num, relTime } from "@/lib/format";
import { Card, CardBody, CardHeader, NavyPanel } from "@/components/ui/card";
import { Badge, StatusChip } from "@/components/ui/badge";
import { Dl, Empty, PageHeader, ScoreChip, Table, td, tdNum, th, thNum } from "@/components/ui/misc";
import { DealStageBadge, LeadStageBadge } from "@/components/ui/domain";
import { Avatar } from "@/components/ui/avatar";
import { Stagger, StaggerItem } from "@/components/ui/motion";
import type { Activity, ActivityKind } from "@/lib/data/types";
import { STATUS_LABEL, STATUS_TONE, clerksFor, courtFocus, currentTools, firmSites, fitNotes, hearingsPerMonth, planFor, seatPrices, shortCity } from "../_components/firm";
import { verdict } from "../_components/perms";
import { DetailActions } from "../_components/account-actions";
import { cn } from "@/lib/utils";

const ICON: Partial<Record<ActivityKind, typeof Phone>> = {
  call: Phone, whatsapp_in: MessageCircle, whatsapp_out: MessageCircle, email_sent: Mail, email_open: Mail, email_click: Mail,
  demo_booked: CalendarCheck2, demo_done: Video, proposal_sent: FileText, stage_change: Repeat2, note: NotebookPen, page_view: Globe, form_submit: Globe,
};
const DECISION = ["Managing Partner", "Senior Advocate", "Partner", "Founding Advocate"];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { ds } = await pageCtx();
  const a = await ds.account((await params).id);
  return { title: a?.name ?? "Law firm" };
}

export default async function AccountDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ds, now, role, support, session, scope, masked } = await pageCtx();
  const acc = await ds.account(id);
  if (!acc) notFound();
  const [allLeads, allDeals, team, acts] = await Promise.all([ds.leads(), ds.deals(), ds.team(), ds.activities()]);
  const firmLeads = allLeads.filter((l) => l.accountId === acc.id);
  const contacts = scope.leads(firmLeads).sort((a, b) => b.score - a.score);
  const hiddenContacts = firmLeads.length - contacts.length;
  const deals = scope.deals(allDeals.filter((d) => d.accountId === acc.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ids = new Set(contacts.map((c) => c.id));
  const timeline = acts.filter((a) => ids.has(a.leadId)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 18);
  const nameOf = (uid?: string) => team.find((t) => t.id === uid)?.name;
  const owner = nameOf(acc.ownerId) ?? "Unassigned";
  const sites = firmSites(acc), focus = courtFocus(acc.courts);
  const prices = seatPrices(allDeals);
  const plan = planFor(acc.lawyers), estimate = acc.lawyers * prices[plan];
  const open = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const won = allDeals.filter((d) => d.accountId === acc.id && d.stage === "won").sort((a, b) => (b.wonAt ?? "").localeCompare(a.wonAt ?? ""))[0];
  const ctx = { role, support, uid: session.uid, ownerId: acc.ownerId };
  const byDay = timeline.reduce<Record<string, Activity[]>>((m, a) => { (m[dayKey(a.at)] ??= []).push(a); return m; }, {});

  return (
    <>
      <Link href="/accounts" className="mb-3 inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink"><ArrowLeft className="size-3.5" aria-hidden />Law firms</Link>
      <PageHeader eyebrow={`${acc.district} district · ICP tier ${acc.icpTier}`} title={acc.name}
        sub={`${acc.locality}, ${shortCity(acc.city)} · ${acc.lawyers} lawyer${acc.lawyers === 1 ? "" : "s"}, ${clerksFor(acc)} clerk${clerksFor(acc) === 1 ? "" : "s"} · owner ${owner}`}
        actions={<DetailActions accountId={acc.id} firm={acc.name} seats={acc.lawyers} plan={plan}
          addContact={verdict("addContact", ctx)} createDeal={verdict("createDeal", ctx)} logActivity={verdict("logActivity", ctx)} />}>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone={STATUS_TONE[acc.status]}>{STATUS_LABEL[acc.status]}</Badge>
          {focus.map((c) => <Badge key={c} tone={c.includes("HC") || c === "Madurai Bench" ? "accent" : "neutral"}>{c}</Badge>)}
        </div>
      </PageHeader>

      <Stagger className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <StaggerItem className="grid content-start gap-4 lg:col-span-8">
          <Card>
            <CardHeader title="Firm profile" sub={`Founded ${acc.founded} · ${acc.website}`} />
            <CardBody>
              <Dl items={[
                ["Courts", acc.courts.join(" · ")],
                ["Practice areas", acc.practiceAreas.join(", ")],
                ["Size", `${acc.size} (${acc.lawyers} lawyer${acc.lawyers === 1 ? "" : "s"}, ${clerksFor(acc)} clerk${clerksFor(acc) === 1 ? "" : "s"})`],
                ["Sites", <ul key="s" className="space-y-1">{sites.map((s) => <li key={s.label} className="flex items-start gap-1.5"><MapPin className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden /><span>{s.label}{s.hq ? " (HQ)" : ""}{s.note ? <span className="text-ink-3"> · {s.note}</span> : null}</span></li>)}</ul>],
                ["Current tools", currentTools(acc)],
                ["Last activity", `${relTime(acc.lastActivityAt, now)} (${fmtDateY(acc.lastActivityAt)})`],
              ]} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Contacts" sub={masked ? "Hidden for your role: Viewer sees firm-level data only." : `${contacts.length} people at this firm${hiddenContacts > 0 ? `; ${hiddenContacts} owned by other reps are not shown` : ""}`} />
            {masked ? <div className="px-4 pb-4 sm:px-5"><Empty title={`${firmLeads.length} contacts on file`}>Names, phone numbers and timelines are not shown to Viewers. Ask your Owner if you need them.</Empty></div>
              : contacts.length === 0 ? <div className="px-4 pb-4 sm:px-5"><Empty title="No contacts you can see at this firm yet.">Add the managing partner or office manager first; they decide on software.</Empty></div> : (
              <>
                <Table minWidth={600} className="hidden md:block">
                  <thead><tr className="border-y border-line bg-paper/60"><th className={th}>Name</th><th className={th}>Role</th><th className={th}>Consent</th><th className={th}>Stage</th><th className={thNum}>Score</th></tr></thead>
                  <tbody>{contacts.map((c) => (
                    <tr key={c.id} className="border-b border-line last:border-0 hover:bg-paper/60">
                      <td className={cn(td, "h-auto py-2")}><div className="flex items-center gap-2"><Link href={`/leads/${c.id}`} className="font-medium hover:text-accent">{c.name}</Link>{DECISION.includes(c.title) && <Badge tone="navy">Decision maker</Badge>}</div><div className="mt-0.5 text-[12px] text-ink-3 num">{c.phone} · {c.email}</div></td>
                      <td className={cn(td, "text-ink-2")}>{c.title}</td>
                                            <td className={td}><div className="flex gap-1">{c.consent.whatsapp ? <Badge tone="success">WhatsApp</Badge> : <Badge tone="outline">No WhatsApp</Badge>}{c.consent.marketing && <Badge tone="neutral">Email</Badge>}</div></td>
                      <td className={td}><LeadStageBadge stage={c.stage} /></td>
                      <td className={tdNum}><ScoreChip score={c.score} /></td>
                    </tr>))}
                  </tbody>
                </Table>
                <ul className="divide-y divide-line border-t border-line md:hidden">{contacts.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/leads/${c.id}`} className="block truncate text-[13px] font-medium">{c.name}</Link>
                      <div className="mt-0.5 truncate text-[12px] text-ink-3">{c.title}{DECISION.includes(c.title) ? " · decision maker" : ""} · {c.consent.whatsapp ? "WhatsApp opted in" : "no WhatsApp consent"}</div>
                    </div>
                    <ScoreChip score={c.score} />
                    <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="grid size-11 place-items-center rounded-sm border border-line-strong text-ink-2" aria-label={`Call ${c.name}`}><Phone className="size-4" aria-hidden /></a>
                  </li>))}
                </ul>
              </>
            )}
          </Card>

          <Card>
            <CardHeader title="Deals" sub={role === "sales_rep" ? "Your deals with this firm" : `${open.length} open, ${deals.length - open.length} closed`} action={<span className="text-[12px] text-ink-3 num">{inrCompact(open.reduce((s, d) => s + d.value, 0))} open</span>} />
            {deals.length === 0 ? <div className="px-4 pb-4 sm:px-5">{acc.status === "customer" ? <Empty title="Signed before this 90-day window.">The renewal is tracked in the Customer panel; open a deal for added seats or a plan upgrade.</Empty> : <Empty title="No deals with this firm yet.">Open a deal once the partners agree to a demo.</Empty>}</div> : (
              <ul className="divide-y divide-line border-t border-line">{deals.map((d) => (
                <li key={d.id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><span className="truncate text-[13px] font-medium">{d.plan} · {d.seats} seats</span><DealStageBadge stage={d.stage} /></div>
                    <div className="mt-0.5 text-[12px] text-ink-3 num">{d.id} · {nameOf(d.ownerId)} · {d.stage === "won" ? `won ${fmtDate(d.wonAt ?? d.stageEnteredAt)}` : d.stage === "lost" ? d.lostReason ?? "lost" : `expected close ${fmtDate(d.expectedClose)}`}</div>
                  </div>
                  <div className="text-right"><div className="text-[13px] font-semibold num">{inr(d.value)}</div><div className="text-[11px] text-ink-3 num">{Math.round(d.probability * 100)}% likely</div></div>
                </li>))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Activity across all contacts" sub={masked ? "Timelines are not shown to Viewers." : "Latest 18 events, newest first"} />
            {masked ? null : timeline.length === 0 ? <div className="px-4 pb-4 sm:px-5"><Empty title="Nothing logged yet.">Log the first call or meeting so the next person knows where this firm stands.</Empty></div> : (
              <ol className="border-t border-line px-4 py-3 sm:px-5">
                {Object.entries(byDay).map(([day, items]) => (
                  <li key={day} className="mb-3 last:mb-0">
                    <div className="eyebrow mb-2">{fmtDateY(items[0].at)}</div>
                    <ul className="space-y-2.5 border-l border-line pl-4">{items.map((a) => {
                      const I = ICON[a.kind] ?? Building2; const who = contacts.find((c) => c.id === a.leadId);
                      return (
                        <li key={a.id} className="relative">
                          <span className="absolute -left-[25px] top-0.5 grid size-[18px] place-items-center rounded-full border border-line bg-surface text-ink-3"><I className="size-2.5" aria-hidden /></span>
                          <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]"><span className="font-medium text-ink">{a.title}</span><span className="text-[12px] text-ink-3 num">{fmtTime(a.at)} · {who?.name}</span></div>
                          {a.detail && <p className="mt-0.5 text-[12px] leading-5 text-ink-2">{a.detail}</p>}
                        </li>
                      );
                    })}</ul>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </StaggerItem>

        <StaggerItem className="order-first grid content-start gap-4 lg:order-none lg:col-span-4">
          <NavyPanel className="p-5">
            <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-navy-ink-3">LAWSOME plan fit</div>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div><div className="text-[22px] font-semibold leading-7">{plan}</div><div className="text-[12px] text-navy-ink-2 num">{acc.lawyers} advocate seats · clerks free</div></div>
              <div className="text-right"><div className="text-[18px] font-semibold num">{inrCompact(estimate)}</div><div className="text-[11px] text-navy-ink-3">per year, est.</div></div>
            </div>
            <ul className="mt-4 space-y-2 border-t border-navy-line pt-3 text-[13px] leading-5 text-navy-ink-2">
              {fitNotes(acc).map((n) => <li key={n} className="flex gap-2"><span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-accent-on-navy" />{n}</li>)}
            </ul>
            <p className="mt-3 text-[11px] text-navy-ink-3 num">Estimate uses {inr(prices[plan])} per seat per year from this workspace&apos;s {plan} deals (placeholder pricing).</p>
          </NavyPanel>

          <Card>
            <CardHeader title="At a glance" />
            <CardBody>
              <Dl items={[
                ["Hearings / month", <span key="h" className="num">~{num(hearingsPerMonth(acc))}</span>],
                ["Contacts", <span key="c" className="num">{firmLeads.length}</span>],
                ["Best score", masked ? "—" : contacts[0] ? <ScoreChip key="s" score={contacts[0].score} /> : "—"],
                ["Owner", <span key="o" className="inline-flex items-center gap-1.5"><Avatar name={owner} size={20} />{owner}</span>],
              ]} />
            </CardBody>
          </Card>

          {acc.status === "customer" || won ? (
            <Card>
              <CardHeader title="Customer" sub="After Won: plan, seats and payments" action={<StatusChip status="showcase" label="Razorpay: Showcase" />} />
              <CardBody>
                <Dl items={[
                  ["Plan", won ? `${won.plan}, ${won.seats} seats` : "Renewal base (signed before this window)"],
                  ["ARR", <span key="a" className="num">{inr(acc.arr || won?.value || 0)}</span>],
                  ["Go-live", won?.wonAt ? fmtDateY(new Date(new Date(won.wonAt).getTime() + 14 * 86400e3).toISOString()) : "Live"],
                  ["Payments", "Sample: annual invoice paid by NEFT"],
                ]} />
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Next step" />
              <CardBody className="text-[13px] leading-5 text-ink-2">
                {open.length ? <>Open deal in <strong className="font-medium text-ink">{open[0].stage.replace("_", " ")}</strong>, expected close {fmtDate(open[0].expectedClose)}.</>
                  : contacts.some((c) => DECISION.includes(c.title)) ? "A decision maker is on file. Offer a 20-minute demo on their own case numbers, after court hours." : "No decision maker on file yet. Add the managing partner before opening a deal."}
              </CardBody>
            </Card>
          )}
        </StaggerItem>
      </Stagger>
    </>
  );
}
