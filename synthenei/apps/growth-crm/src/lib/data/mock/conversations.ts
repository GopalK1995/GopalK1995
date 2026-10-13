// Hand-written inbox threads (fictional). The AI drafts are canned demo outputs; nothing calls a model.
import type { Account, Conversation, Lead, Message } from "../types";
import { HOUR, MIN, NOW_MS, iso, type Rng } from "./seed";

type Tpl = {
  channel: Conversation["channel"]; subject: string;
  msgs: [Message["from"], number /* minutes ago */, string][];
  draft: string; why: string[]; basedOn: string; review?: string; unread: number;
};

const T = (first: string, firm: string, city: string): Tpl[] => [
  {
    channel: "whatsapp", subject: "Madurai Bench cause list", unread: 2,
    msgs: [
      ["us", 1460, `Vanakkam ${first}, this is from LAWSOME. You asked about cause-list alerts for the Madurai Bench. Shall I set up a 20-minute demo on your own case numbers?`],
      ["lead", 1390, "Yes. But we have around 60 matters, half of them at district court. Will both come?"],
      ["us", 1380, "Both come into one calendar — Madurai Bench from the High Court site, district matters from eCourts. Listings refresh at 7 am and 7 pm."],
      ["lead", 52, "OK. Can you show it Thursday after court hours? My junior Selvi will also join."],
      ["lead", 50, "Around 5.30 pm"],
    ],
    draft: `Thursday 5.30 pm works, ${first}. I've blocked 30 minutes and will send a Google Meet link to you and Selvi. If you share 3–4 case numbers (Madurai Bench + district) before the call, I'll load them so you see your own listings live.`,
    why: ["Lead proposed Thursday 5:30 pm; rep calendar is free", "Junior (Selvi) mentioned — invite both", "Asked about district + High Court coverage earlier in thread"], basedOn: "Based on 5 messages in this thread (Mon–Tue) and Arun's calendar",
  },
  {
    channel: "email", subject: `Pricing for ${firm} (11 advocates)`, unread: 1,
    msgs: [
      ["lead", 2900, `Hello, we are ${firm}, ${city}. We have 11 advocates and 3 clerks. What is the annual price, and do clerks need a paid seat?`],
      ["us", 2700, "Thank you for writing. Our Chambers plan is ₹1,800 per seat per month billed annually. I'll confirm the clerk question with my manager today."],
      ["lead", 180, "Please also tell if data is stored in India. One of our partners is particular about this."],
    ],
    draft: `Dear ${first}, clerks can use a free "staff" seat (calendar and diary only), so the quote is for 11 advocate seats: ₹2,37,600 per year on the Chambers plan, plus GST. All workspace data is hosted in the AWS Mumbai region and never leaves India. I can walk your partners through our data-handling note on a short call — would Friday 4 pm suit?`,
    why: ["Seats: 11 advocates × ₹21,600 = ₹2,37,600 (Chambers, annual; placeholder price)", "Staff seat policy from pricing sheet v4", "Data-residency answer from security FAQ; partner concern flagged"], basedOn: "Based on 3 emails (9–13 Oct), pricing sheet v4 (placeholder prices) and the security FAQ",
  },
  {
    channel: "linkedin", subject: "Re: Hearing-day visibility", unread: 0,
    msgs: [
      ["lead", 4300, "Saw your post on hearing reminders. We tried two apps and juniors stopped using both within a month."],
      ["us", 4200, `Fair concern, ${first}. Most chambers we work with in Chennai get juniors on it because the 7 am WhatsApp summary replaces the cause-list forward they already read. Could I show you how ${firm} would look with it?`],
      ["lead", 1500, "Maybe next week. Busy with a matter at the High Court."],
    ],
    draft: `Understood — all the best with the hearing. I'll check back on Tuesday. Meanwhile, here's a 2-minute recording of the 7 am summary on a sample Madras High Court diary, so you can judge whether juniors would actually read it.`,
    why: ["Lead deferred to 'next week' — propose specific day", "Objection: past tools abandoned by juniors", "Low-effort next step instead of pushing for a call"], basedOn: "Based on 3 LinkedIn messages (10–12 Oct) and 1 campaign click",
  },
  {
    channel: "whatsapp", subject: "Trial workspace access", unread: 1,
    msgs: [
      ["us", 3000, `Hi ${first}, your trial workspace is ready. Login link sent to your email.`],
      ["lead", 95, "Got it. How do I import our old diary? It is in Excel, 6 years."],
    ],
    draft: `Easy — use Settings → Import → "Case diary (Excel)". Our template maps case number, court, next date and client. For 6 years of data I'd suggest we import it for you: send the file on email and we'll have it in your workspace within one working day.`,
    why: ["Question: Excel import", "Volume (6 years) suggests assisted import", "Lead is in trial, high fit (score 82)"], basedOn: "Based on 2 WhatsApp messages and the trial workspace record",
  },
  {
    channel: "email", subject: "Ask Nidhi — confidentiality question", unread: 0,
    msgs: [
      ["lead", 6200, "Does Ask Nidhi train on our pleadings? We cannot allow client documents to be used elsewhere."],
      ["us", 6000, "No. Documents stay in your workspace and are not used to train any model. I'm sending our data-processing note."],
      ["lead", 600, "Thanks. Our senior partner wants this in the agreement itself, not a note."],
    ],
    draft: `Understood, ${first}. Our standard agreement already has a clause (Schedule B, 4.2) stating that customer content is not used for model training. I'll share the exact clause text today; if your senior partner needs different wording, our counsel can review a marked-up version.`,
    why: ["Contractual request — needs human/legal review before sending", "Clause reference from MSA template (verify current version)"], basedOn: "Based on 3 emails (8–13 Oct) and the MSA template", review: "Legal commitment: needs Owner or counsel review before sending",
  },
  {
    channel: "whatsapp", subject: "Demo reschedule", unread: 0,
    msgs: [
      ["lead", 260, "Sorry, adjournment came in my matter today. Can we move the demo to Saturday morning?"],
    ],
    draft: `No problem at all, ${first}. Saturday 10.30 am or 11.30 am — which suits you better? I'll move the invite once you confirm.`,
    why: ["Reschedule request on demo day", "Saturday slots open on rep calendar", "Offer two concrete options"], basedOn: "Based on 1 WhatsApp message today and Saturday calendar slots",
  },
];

export function buildConversations(leads: Lead[], accounts: Account[], rng: Rng): Conversation[] {
  const picks = [
    leads.find((l) => l.city === "Madurai" && l.channel === "whatsapp") ?? leads[3 % leads.length],
    leads.find((l) => l.stage === "qualified" && l.city === "Coimbatore") ?? leads[8 % leads.length],
    leads.find((l) => l.channel === "linkedin" && l.city === "Chennai") ?? leads[12 % leads.length],
    leads.find((l) => l.stage === "demo_done") ?? leads[15 % leads.length],
    leads.find((l) => l.stage === "proposal") ?? leads[20 % leads.length],
    leads.find((l) => l.stage === "demo_booked") ?? leads[25 % leads.length],
  ];
  // Small workspaces may pick the same lead twice: keep the first thread per lead.
  const seen = new Set<string>();
  return picks.map((l, i) => [l, i] as const).filter(([l]) => l && !seen.has(l.id) && seen.add(l.id)).map(([l, i]) => {
    const acc = accounts.find((a) => a.id === l.accountId)!;
    const t = T(l.name.split(" ")[0], acc.name, acc.city)[i];
    const messages: Message[] = t.msgs.map(([from, ago, body], j) => ({
      id: `m-${i}-${j}`, from, at: iso(NOW_MS - ago * MIN), body, authorId: from === "us" ? l.ownerId : undefined,
      status: from === "us" ? (j < t.msgs.length - 1 ? "read" : "delivered") : undefined,
    }));
    return {
      id: `CV-${71 + i}`, leadId: l.id, channel: t.channel, subject: t.subject, unread: t.unread,
      lastAt: messages[messages.length - 1].at, messages,
      aiDraft: { body: t.draft, rationale: t.why, basedOn: t.basedOn, needsReview: t.review },
    } satisfies Conversation;
  }).sort((a, b) => b.lastAt.localeCompare(a.lastAt)).map((c) => ({ ...c, lastAt: c.lastAt || iso(NOW_MS - rng.int(1, 9) * HOUR) }));
}
