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
import { STATUS_TONE, clerksFor, courtFocus, currentTools, firmSites, fitNotes, hearingsPerMonth, planFor, seatPrices, shortCity } from "../_components/firm";
import { verdict } from "../_components/perms";
import { DetailActions } from "../_components/account-actions";
import { cn } from "@/lib/utils";
import { vocabFor } from "@/lib/vertical";
import { accountsRepo } from "@/lib/db/repo/accounts";
import { contactsRepo } from "@/lib/db/repo/contacts";
import type { Contact } from "@/lib/db/repo/types";
import { AssignAccountDialog, DeleteAccountDialog, EditAccountDialog, MergeAccountDialog } from "../_components/record-actions";
import { AddContactDialog } from "../../contacts/_components/contact-dialogs";
import { ContactsTable } from "../../contacts/_components/contacts-table";
import { at } from "../_lib/strings";
import { ErrorState } from "@/components/ui/states";

const ICON: Partial<Record<ActivityKind, typeof Phone>> = {
  call: Phone, whatsapp_in: MessageCircle, whatsapp_out: MessageCircle, email_sent: Mail, email_open: Mail, email_click: Mail,
  demo_booked: CalendarCheck2, demo_done: Video, proposal_sent: FileText, stage_change: Repeat2, note: NotebookPen, page_view: Globe, form_submit: Globe,
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { ds, active } = await pageCtx();
  const a = await ds.account((await params).id);
  return { title: a?.name ?? vocabFor(active.tenant).ac.metaTitle };
}

export default async function AccountDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ds, now, role, support, session, scope, masked, active } = await pageCtx();
  const v = vocabFor(active.tenant), ac = v.ac, d_ = ac.d, hosp = v.id === "hospitality", STATUS_LABEL = ac.status, DECISION = ac.decision;
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
  const sites = firmSites(acc), focus = hosp ? acc.roomsOfInterest ?? [] : courtFocus(acc.courts);
  const prices = seatPrices(allDeals);
  const wonAll = allDeals.filter((d) => d.accountId === acc.id && d.stage === "won");
  const plan = hosp ? wonAll[0]?.stay?.room ?? acc.roomsOfInterest?.[0] ?? v.pl.plans[0] : planFor(acc.lawyers);
  const nightly = (() => { const n = allDeals.filter((d) => d.stage === "won" && d.seats > 0); return n.length ? Math.round(n.reduce((a, d) => a + d.value / d.seats, 0) / n.length) : 0; })();
  const estimate = hosp ? (wonAll.length ? Math.round(wonAll.reduce((a, d) => a + d.value, 0) / wonAll.length) : nightly * 2) : acc.lawyers * prices[planFor(acc.lawyers)];
  const hospNotes = [
    `${acc.stays ?? 0} previous ${acc.stays === 1 ? "stay" : "stays"}; ${acc.repeatGuest ? "a repeat guest, so offer the direct-booking rate" : "not yet a repeat guest, so share the welcome note after the first stay"}.`,
    ...(acc.interests?.length ? [`Usually travels for ${acc.interests.join(", ").toLowerCase()}.`] : []),
    ...(acc.roomsOfInterest?.length ? [`Prefers ${acc.roomsOfInterest.join(" or ")}.`] : []),
    acc.guestKind === "travel_agent" ? "Travel partner: send the net rate card before the season opens." : acc.guestKind === "corporate" ? "Corporate group: quote a package with meals and a meeting space." : acc.guestKind === "wedding_planner" ? "Wedding planner: share events-lawn and dorm loft availability early." : "Family guest: a WhatsApp reply in the evening works best.",
  ];
  const open = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const won = allDeals.filter((d) => d.accountId === acc.id && d.stage === "won").sort((a, b) => (b.wonAt ?? "").localeCompare(a.wonAt ?? ""))[0];
  const ctx = { role, support, uid: session.uid, ownerId: acc.ownerId };
  // Persisted facts (version, owner, live contacts) come from the repositories in real workspaces; demo keeps the mock data.
  const real = !session.demo, t = at(v);
  let rec = { version: 1, ownerId: (acc.ownerId || null) as string | null, city: acc.city as string, district: acc.district, website: acc.website };
  let targets: { id: string; name: string; version: number }[] = [];
  let realContacts: Contact[] | "error" = [];
  if (real) {
    const ws = active.ws.uuid;
    try {
      const [row, list] = await Promise.all([accountsRepo.get(ws, acc.id), accountsRepo.list(ws, { limit: 200 })]);
      if (row) rec = { version: row.version, ownerId: row.ownerId, city: row.city ?? "", district: row.district ?? "", website: row.website ?? "" };
      targets = list.rows.map((r) => ({ id: r.id, name: r.name, version: r.version }));
    } catch (e) { console.error("[account page]", e); }
    try { realContacts = (await contactsRepo.list(ws, { limit: 100, filters: [{ field: "accountId", op: "eq", value: acc.id }] })).rows; } catch (e) { console.error("[account contacts]", e); realContacts = "error"; }
  }
  const owners = team.filter((m) => m.role !== "viewer").map((m) => ({ id: m.id, name: m.name }));
  const ea = { id: acc.id, version: rec.version, name: acc.name, city: rec.city, district: rec.district, website: rec.website, ownerId: rec.ownerId };
  const districtOpts = [rec.district].filter(Boolean);
  const realCard = realContacts === "error"
    ? <div className="px-4 pb-4 sm:px-5"><ErrorState source={t("ui.contactsTitle")} message={t("ui.contactsErrorHint")} /></div>
    : <ContactsTable rows={realContacts} accounts={[{ id: acc.id, name: acc.name }]} t={t} role={role} support={support} uid={session.uid} showAccount={false}
        emptyAction={<AddContactDialog v={verdict("addContact", ctx)} accounts={[{ id: acc.id, name: acc.name }]} accountId={acc.id} />} />;

  const byDay = timeline.reduce<Record<string, Activity[]>>((m, a) => { (m[dayKey(a.at)] ??= []).push(a); return m; }, {});

  return (
    <>
      <Link href="/accounts" className="mb-3 inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink"><ArrowLeft className="size-3.5" aria-hidden />{ac.back}</Link>
      <PageHeader eyebrow={d_.eyebrow(acc.district, acc.icpTier, acc.guestKind ? ac.kinds[acc.guestKind] ?? "" : "")} title={acc.name}
        sub={d_.sub(`${acc.locality}, ${shortCity(acc.city)}`, acc.lawyers, clerksFor(acc), owner, acc.stays ?? 0)}
        actions={<>
          <DetailActions accountId={acc.id} firm={acc.name} seats={hosp ? 2 : acc.lawyers} plan={plan} createDeal={verdict("createDeal", ctx)} logActivity={verdict("logActivity", ctx)} />
          <AddContactDialog v={verdict("addContact", { ...ctx, ownerId: rec.ownerId ?? undefined })} accounts={[{ id: acc.id, name: acc.name }]} accountId={acc.id} />
          <EditAccountDialog v={verdict("editAccount", { ...ctx, ownerId: rec.ownerId ?? undefined })} a={ea} districts={districtOpts} />
          <AssignAccountDialog v={verdict("assignAccount", ctx)} a={ea} owners={owners} />
          <MergeAccountDialog v={verdict("mergeAccount", ctx)} a={ea} targets={targets.length ? targets : [{ id: acc.id, name: acc.name, version: rec.version }]} />
          <DeleteAccountDialog v={verdict("deleteAccount", ctx)} a={ea} />
        </>}>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone={STATUS_TONE[acc.status]}>{STATUS_LABEL[acc.status]}</Badge>
          {focus.map((c) => <Badge key={c} tone={!hosp && (c.includes("HC") || c === "Madurai Bench") ? "accent" : "neutral"}>{c}</Badge>)}
        </div>
      </PageHeader>

      <Stagger className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <StaggerItem className="grid content-start gap-4 lg:col-span-8">
          <Card>
            <CardHeader title={d_.profile} sub={d_.profileSub(acc.founded, acc.website, acc.stays ?? 0)} />
            <CardBody>
              <Dl items={hosp ? [
                ["Rooms of interest", (acc.roomsOfInterest ?? []).join(" · ") || "Any"],
                ["Trip types", (acc.interests ?? []).join(", ") || "Not recorded"],
                ["Party size", `${v.partySize[acc.size]}${acc.lawyers ? ` (usually ${acc.lawyers} guests)` : ""}`],
                ["Stays", <span key="st" className="num">{acc.stays ?? 0}</span>],
                ["Last activity", `${relTime(acc.lastActivityAt, now)} (${fmtDateY(acc.lastActivityAt)})`],
              ] : [
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
            <CardHeader title={d_.contacts} sub={masked ? d_.contactsMasked : real ? undefined : d_.contactsSub(contacts.length, hiddenContacts)} />
            {real && !masked ? realCard : masked ? <div className="px-4 pb-4 sm:px-5"><Empty title={d_.maskedEmpty(firmLeads.length)}>Names, phone numbers and timelines are not shown to Viewers. Ask your Owner if you need them.</Empty></div>
              : contacts.length === 0 ? <div className="px-4 pb-4 sm:px-5"><Empty title={d_.noContacts}>{d_.noContactsHint}</Empty></div> : (
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
            <CardHeader title={d_.deals} sub={d_.dealsSub(role === "sales_rep", open.length, deals.length - open.length)} action={<span className="text-[12px] text-ink-3 num">{inrCompact(open.reduce((s, d) => s + d.value, 0))} open</span>} />
            {deals.length === 0 ? <div className="px-4 pb-4 sm:px-5">{acc.status === "customer" ? <Empty title={d_.signedBefore}>{d_.signedBeforeHint}</Empty> : <Empty title={d_.noDeals}>{d_.noDealsHint}</Empty>}</div> : (
              <ul className="divide-y divide-line border-t border-line">{deals.map((d) => (
                <li key={d.id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><span className="truncate text-[13px] font-medium">{d_.dealLine(d.plan, d.seats, d.stay?.room ?? null)}</span><DealStageBadge stage={d.stage} /></div>
                    <div className="mt-0.5 text-[12px] text-ink-3 num">{d.id} · {nameOf(d.ownerId)} · {d.stage === "won" ? `won ${fmtDate(d.wonAt ?? d.stageEnteredAt)}` : d.stage === "lost" ? d.lostReason ?? "lost" : `expected close ${fmtDate(d.expectedClose)}`}</div>
                  </div>
                  <div className="text-right"><div className="text-[13px] font-semibold num">{inr(d.value)}</div><div className="text-[11px] text-ink-3 num">{Math.round(d.probability * 100)}% likely</div></div>
                </li>))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Activity across all contacts" sub={masked ? "Timelines are not shown to Viewers." : "Latest 18 events, newest first"} />
            {masked ? null : timeline.length === 0 ? <div className="px-4 pb-4 sm:px-5"><Empty title="Nothing logged yet.">{d_.logEmpty}</Empty></div> : (
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
            <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-navy-ink-3">{hosp ? d_.fitTitle : `${active.tenant.name} plan fit`}</div>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div><div className="text-[22px] font-semibold leading-7">{plan}</div><div className="text-[12px] text-navy-ink-2 num">{d_.fitSub(acc.lawyers)}</div></div>
              <div className="text-right"><div className="text-[18px] font-semibold num">{inrCompact(estimate)}</div><div className="text-[11px] text-navy-ink-3">{d_.fitPer}</div></div>
            </div>
            <ul className="mt-4 space-y-2 border-t border-navy-line pt-3 text-[13px] leading-5 text-navy-ink-2">
              {(hosp ? hospNotes : fitNotes(acc)).map((n) => <li key={n} className="flex gap-2"><span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-accent-on-navy" />{n}</li>)}
            </ul>
            <p className="mt-3 text-[11px] text-navy-ink-3 num">{hosp ? d_.fitFoot(inr(nightly), plan) : d_.fitFoot(inr(prices[planFor(acc.lawyers)]), planFor(acc.lawyers))}</p>
          </NavyPanel>

          <Card>
            <CardHeader title="At a glance" />
            <CardBody>
              <Dl items={[
                [d_.glance, <span key="h" className="num">{hosp ? num(acc.stays ?? 0) : `~${num(hearingsPerMonth(acc))}`}</span>],
                ["Contacts", <span key="c" className="num">{firmLeads.length}</span>],
                ["Best score", masked ? "—" : contacts[0] ? <ScoreChip key="s" score={contacts[0].score} /> : "—"],
                ["Owner", <span key="o" className="inline-flex items-center gap-1.5"><Avatar name={owner} size={20} />{owner}</span>],
              ]} />
            </CardBody>
          </Card>

          {acc.status === "customer" || won ? (
            <Card>
              <CardHeader title={d_.custTitle} sub={d_.custSub} action={<StatusChip status="showcase" label="Razorpay: Showcase" />} />
              <CardBody>
                <Dl items={d_.custRows(won ? (hosp ? won.stay?.room ?? "Stay" : `${won.plan}, ${won.seats} seats`) : d_.custNoWon, inr(acc.arr || won?.value || 0), won?.wonAt ? fmtDateY(hosp && won.stay ? won.stay.checkIn + "T06:00:00Z" : new Date(new Date(won.wonAt).getTime() + 14 * 86400e3).toISOString()) : "Live")} />
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader title={d_.nextTitle} />
              <CardBody className="text-[13px] leading-5 text-ink-2">
                {open.length ? <>Open deal in <strong className="font-medium text-ink">{hosp ? v.dealStage[open[0].stage] : open[0].stage.replace("_", " ")}</strong>, expected close {fmtDate(open[0].expectedClose)}.</>
                  : (hosp ? contacts.length > 0 : contacts.some((c) => DECISION.includes(c.title))) ? d_.nextDecision : d_.nextNone}
              </CardBody>
            </Card>
          )}
        </StaggerItem>
      </Stagger>
    </>
  );
}
