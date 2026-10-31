import { pageCtx } from "@/lib/data/context";
import { maskName } from "@/lib/data/context";
import { accessFor } from "@/lib/auth/roles";
import { Badge, StatusChip } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/states";
import { PageHeader } from "@/components/ui/misc";
import { verticalOf, vocabFor } from "@/lib/vertical";
import { verdict } from "../accounts/_components/perms";
import { InboxApp } from "./_components/inbox-app";
import { tamilDraft } from "./_lib/drafts";
import { buildRealItems } from "./_lib/items";
import { readInbox } from "./_lib/reads";
import { itAll } from "./_lib/strings";
import type { InboxConv, TemplateOpt } from "./_lib/types";

export const metadata = { title: "Inbox" };

export default async function Inbox() {
  const { ds, now, role, support, session, scope, active, masked } = await pageCtx();
  const v = vocabFor(active.tenant);
  const strings = itAll(v);
  const demo = session.demo;
  if (!accessFor(role, "/inbox")) {
    return <><PageHeader eyebrow="Conversations" title="Inbox" /><ErrorState source="permissions" message={strings.deniedPage} /></>;
  }
  const [convs, leads, accounts, deals, team] = await Promise.all([demo ? ds.conversations() : Promise.resolve([]), ds.leads(), ds.accounts(), ds.deals(), ds.team()]);
  const nowMs = new Date(now).getTime();
  const nameOf = (id?: string | null) => team.find((t) => t.id === id)?.name ?? "Unassigned";

  let items: InboxConv[] = [];
  let templates: TemplateOpt[] = [];
  let hidden = 0;
  let loadError = false;

  if (demo) {
    // Showcase: sample conversations from the mock data source. Tamil drafts are LAWSOME sample copy, gated by (demo, legal).
    const legal = verticalOf(active.tenant) === "legal";
    const mine = scope.conversations(convs, leads);
    items = mine.map((c) => {
      const l = leads.find((x) => x.id === c.leadId)!;
      const a = accounts.find((x) => x.id === l.accountId);
      const d = deals.find((x) => x.leadId === l.id && x.stage !== "won" && x.stage !== "lost");
      const lastIn = [...c.messages].reverse().find((m) => m.from === "lead");
      const left = c.channel === "whatsapp" && lastIn ? 24 - (nowMs - new Date(lastIn.at).getTime()) / 3600e3 : null;
      const first = l.name.split(" ")[0];
      return {
        id: c.id, channel: c.channel, subject: c.subject, unread: c.unread, lastAt: c.lastAt,
        messages: c.messages.map((m) => ({ id: m.id, from: m.from, at: m.at, body: m.body, status: m.status, author: m.from === "us" ? nameOf(m.authorId).split(" ")[0] : first })),
        draft: { en: c.aiDraft.body.replace(/I've blocked (\d+) minutes and will send/, "I can block $1 minutes and send").replace(/I'll load them/, "I can load them"), ta: tamilDraft({ demo, legal }, c.id, first), rationale: c.aiDraft.rationale, basedOn: c.aiDraft.basedOn.replace(/\b(Arun|Divya|Karthik)'s calendar/, `${nameOf(l.ownerId).split(" ")[0]}'s calendar`), needsReview: c.aiDraft.needsReview ?? null },
        lead: { id: l.id, name: l.name, first, title: l.title, stage: v.leadStage[l.stage], score: l.score, ownerId: l.ownerId, ownerName: nameOf(l.ownerId), consent: l.consent, phone: l.phone, email: l.email },
        firm: a ? { id: a.id, name: a.name, district: a.district, lawyers: a.lawyers } : null,
        deal: d ? { id: d.id, stage: v.dealStage[d.stage], value: d.value, plan: d.plan, seats: d.seats } : null,
        windowLeftH: left, mine: l.ownerId === session.uid,
        reply: verdict("replyInbox", { role, support, uid: session.uid, ownerId: l.ownerId }),
      };
    });
  } else {
    try {
      const raw = await readInbox(active.ws.uuid, masked);
      const built = buildRealItems({
        raw, leads, accounts, deals, team, v, uid: session.uid, now, masked, ownOnly: role === "sales_rep", maskName,
        replyFor: (assigneeId) => verdict("replyInbox", { role, support, uid: session.uid, ownerId: assigneeId ?? undefined }),
      });
      ({ items, hidden, templates } = built);
    } catch (e) {
      console.error("[inbox] load failed", e);
      loadError = true;
    }
  }

  const linkable = scope.leads(leads).sort((a, b) => b.lastTouchAt.localeCompare(a.lastTouchAt)).slice(0, 60)
    .map((l) => ({ id: l.id, label: `${masked ? maskName(l.name) : l.name} · ${accounts.find((a) => a.id === l.accountId)?.name ?? ""}` }));
  const reps = team.filter((t) => t.role === "sales_rep" || t.role === "sales_manager").map((t) => ({ id: t.id, name: t.name }));
  const unread = items.reduce((s, c) => s + c.unread, 0);

  return (
    <>
      <PageHeader eyebrow="Conversations"
        title={<span className="inline-flex flex-wrap items-center gap-2">Inbox {demo ? <StatusChip status="showcase" /> : <Badge tone="outline">Queue only</Badge>}</span>}
        sub={demo ? v.ib.sub(items.length, unread) : `${items.length} conversations, ${unread} unread. ${strings.queuedBannerHint}`} />
      {loadError ? (
        <ErrorState source="conversations" message={strings.loadError} />
      ) : (
        <InboxApp mode={demo ? "demo" : "real"} items={items} now={now} linkable={linkable} reps={reps} uid={session.uid} wsKey={active.ws.id}
          assign={verdict("assignConversation", { role, support })} readOnlyRole={role === "marketing" || role === "viewer"}
          templates={templates} hidden={hidden} strings={strings} masked={masked} />
      )}
    </>
  );
}
