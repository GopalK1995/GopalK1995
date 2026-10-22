import { pageCtx } from "@/lib/data/context";
import { StatusChip } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { verticalOf, vocabFor } from "@/lib/vertical";
import { verdict } from "../accounts/_components/perms";
import { TAMIL_DRAFTS } from "./_components/drafts-ta";
import { InboxApp, type InboxConv } from "./_components/inbox-app";

export const metadata = { title: "Inbox" };

export default async function Inbox() {
  const { ds, now, role, support, session, scope, active } = await pageCtx();
  const v = vocabFor(active.tenant);
  // Tamil drafts are LAWSOME sample copy keyed by conversation id; other verticals reuse those ids.
  const legal = verticalOf(active.tenant) === "legal";
  const [convs, leads, accounts, deals, team] = await Promise.all([ds.conversations(), ds.leads(), ds.accounts(), ds.deals(), ds.team()]);
  const mine = scope.conversations(convs, leads);
  const nowMs = new Date(now).getTime();
  const nameOf = (id?: string) => team.find((t) => t.id === id)?.name ?? "Unassigned";

  const items: InboxConv[] = mine.map((c) => {
    const l = leads.find((x) => x.id === c.leadId)!;
    const a = accounts.find((x) => x.id === l.accountId);
    const d = deals.find((x) => x.leadId === l.id && x.stage !== "won" && x.stage !== "lost");
    const lastIn = [...c.messages].reverse().find((m) => m.from === "lead");
    const left = c.channel === "whatsapp" && lastIn ? 24 - (nowMs - new Date(lastIn.at).getTime()) / 3600e3 : null;
    const first = l.name.split(" ")[0];
    return {
      id: c.id, channel: c.channel, subject: c.subject, unread: c.unread, lastAt: c.lastAt,
      messages: c.messages.map((m) => ({ id: m.id, from: m.from, at: m.at, body: m.body, status: m.status, author: m.from === "us" ? nameOf(m.authorId).split(" ")[0] : first })),
      draft: { en: c.aiDraft.body.replace(/I've blocked (\d+) minutes and will send/, "I can block $1 minutes and send").replace(/I'll load them/, "I can load them"), ta: (legal && TAMIL_DRAFTS[c.id]?.replaceAll("{first}", first)) || null, rationale: c.aiDraft.rationale, basedOn: c.aiDraft.basedOn.replace(/\b(Arun|Divya|Karthik)'s calendar/, `${nameOf(l.ownerId).split(" ")[0]}'s calendar`), needsReview: c.aiDraft.needsReview ?? null },
      lead: { id: l.id, name: l.name, first, title: l.title, stage: v.leadStage[l.stage], score: l.score, ownerId: l.ownerId, ownerName: nameOf(l.ownerId), consent: l.consent, phone: l.phone, email: l.email },
      firm: a ? { id: a.id, name: a.name, district: a.district, lawyers: a.lawyers } : null,
      deal: d ? { id: d.id, stage: v.dealStage[d.stage], value: d.value, plan: d.plan, seats: d.seats } : null,
      windowLeftH: left, mine: l.ownerId === session.uid,
      reply: verdict("replyInbox", { role, support, uid: session.uid, ownerId: l.ownerId }),
    };
  });
  const linkable = scope.leads(leads).sort((a, b) => b.lastTouchAt.localeCompare(a.lastTouchAt)).slice(0, 60)
    .map((l) => ({ id: l.id, label: `${l.name} · ${accounts.find((a) => a.id === l.accountId)?.name ?? ""}` }));
  const reps = team.filter((t) => t.role === "sales_rep" || t.role === "sales_manager").map((t) => ({ id: t.id, name: t.name }));
  const unread = items.reduce((s, c) => s + c.unread, 0);

  return (
    <>
      <PageHeader eyebrow="Conversations" title={<span className="inline-flex flex-wrap items-center gap-2">Inbox <StatusChip status="showcase" /></span>}
        sub={v.ib.sub(items.length, unread)} />
      <InboxApp items={items} now={now} linkable={linkable} reps={reps} uid={session.uid}
        assign={verdict("assignConversation", { role, support })} readOnlyRole={role === "marketing"} />
    </>
  );
}
