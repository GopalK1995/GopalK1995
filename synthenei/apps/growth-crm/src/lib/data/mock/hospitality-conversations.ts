// Shola Mist inbox: hand-written WhatsApp / Instagram / phone / email threads (fictional, English and Tamil).
// Drafts are canned suggestions for a human to review; nothing here sends or calls a model.
import type { Account, Conversation, Deal, Lead, Message } from "../types";
import { MIN, NOW_MS, iso } from "./seed";

type Tpl = {
  channel: Conversation["channel"]; via?: Conversation["via"]; subject: string; unread: number;
  msgs: [Message["from"], number /* minutes ago */, string][];
  draft: string; why: string[]; basedOn: string; review?: string;
};

const T = (first: string): Tpl[] => [
  { channel: "whatsapp", subject: "Pongal 14-17 Jan, family of 5, 2 rooms", unread: 2,
    msgs: [
      ["lead", 190, `Hello, we are a family of 5 (3 adults, 2 children aged 9 and 12). Looking for Pongal weekend, 14 to 17 January. Do you have 2 rooms?`],
      ["us", 170, "Vanakkam! Thanks for writing to Shola Mist. Let me check the calendar for 14 to 17 January."],
      ["lead", 35, "Please also tell the rate with breakfast. We will confirm today if it is reasonable."],
      ["lead", 33, "Is there a bonfire in the evening?"],
    ],
    draft: `Hello ${first}, yes, we can hold the Family Suite plus one Garden Cottage for 14 to 17 January (3 nights). Festival rate: Rs 10,250 per night for the suite and Rs 4,400 for the cottage, breakfast included, so Rs 43,950 in total. A 40% advance (Rs 17,600) confirms it. We do a bonfire on Friday and Saturday evenings, free for guests. Shall I send the payment link and hold the rooms for 48 hours?`,
    why: ["Dates fall in the Pongal festival window (25% uplift applied)", "2 rooms for 5 guests: Family Suite + Garden Cottage", "Asked about breakfast and bonfire: both answered from the property sheet"], basedOn: "Based on 4 WhatsApp messages today and the tariff sheet (festival rates)", review: "Check the rooms are actually free on 14-17 Jan before sending: the calendar is not connected in the demo" },
  { channel: "whatsapp", subject: "தீபாவளி வார இறுதி அறை", unread: 1,
    msgs: [
      ["us", 2900, "வணக்கம்! Shola Mist-இல் மீண்டும் தங்க விரும்பிய உங்களுக்கு நன்றி. தீபாவளி வாரத்தில் 10% தள்ளுபடி உண்டு. அறை வேண்டுமா?"],
      ["lead", 600, "ஆமாம், நவம்பர் 6 முதல் 9 வரை. நாங்கள் 4 பேர். கடந்த முறை இருந்த Garden Cottage கிடைக்குமா?"],
      ["lead", 598, "காலை உணவு சேர்த்து எவ்வளவு ஆகும்?"],
    ],
    draft: `வணக்கம் ${first}, நவம்பர் 6 முதல் 9 வரை Garden Cottage கிடைக்கிறது. ஒரு இரவுக்கு ரூ 4,400 (காலை உணவுடன்), மூன்று இரவுகளுக்கு ரூ 13,200. மீண்டும் வருபவர்களுக்கான 10% தள்ளுபடியுடன் ரூ 11,900. 2 பேருக்கு மேல் என்பதால் ஒரு கூடுதல் படுக்கை ரூ 800 ஒரு இரவுக்கு. அறையை 48 மணி நேரம் பிடித்து வைக்கட்டுமா?`,
    why: ["Repeat guest, Diwali broadcast reply", "Garden Cottage as last time, 4 guests need an extra bed", "Repeat-guest 10% applied to the festival rate"], basedOn: "Based on the broadcast reply, the guest's last stay and the Diwali tariff" },
  { channel: "whatsapp", via: "instagram", subject: "Instagram DM: monsoon rates for a Bengaluru couple", unread: 1,
    msgs: [
      ["lead", 480, "Hi! Saw your reel. We are a couple from Bengaluru, want a quiet weekend. What are the monsoon rates?"],
      ["us", 440, "Hello, thank you! Which weekend are you looking at? Valley-view Room is Rs 5,200 a night in the lean season."],
      ["lead", 120, "Next weekend 17-18 Oct? Is it still raining a lot? Is the road okay for a sedan?"],
    ],
    draft: `Hi ${first}, 17 and 18 October: Valley-view Room is free. The monsoon lull has ended, so it is Rs 5,700 per night with breakfast (Rs 11,400 for 2 nights). The ghat road is fine for a sedan; the rain is mostly evening drizzle now. Cool mornings and mist, good for a quiet weekend. Want me to hold it and share the advance link?`,
    why: ["Asked about road and weather: answered conservatively", "Weekend rate with light uplift from the tariff sheet", "Couple from Bengaluru: typical weekender profile"], basedOn: "Based on 3 Instagram messages and the tariff sheet", review: "Weather and road statements are general: check the local advisory before sending" },
  { channel: "whatsapp", subject: "Group rate for 12 pax, circuit stop", unread: 0,
    msgs: [
      ["lead", 1500, "Namaste, we have a group of 12 from Chennai on an Ooty, Coonoor, Kodaikanal circuit, 22-23 Nov. Can you give group rate for 1 night in Coonoor?"],
      ["us", 1440, "Namaste! Yes, we have partner rates for groups of 8 and more. Sending the rate sheet now."],
      ["lead", 240, "Rate sheet received. Can you do Rs 3,800 per head for dinner, bed and breakfast?"],
    ],
    draft: `Thanks ${first}. For 12 guests on 22 November we can offer the Dorm loft (8) plus two Garden Cottages at a net group rate of Rs 3,900 per head with dinner, bed and breakfast (Rs 46,800 total). The partner commission is 10% on confirmed bookings. Rs 3,800 would need the Dorm loft for all 12 on mattresses: I can check that with Kavitha.`,
    why: ["Partner rate sheet already sent", "Counter-offer slightly above the guest's ask", "Group over loft capacity: owner approval needed for discount below sheet"], basedOn: "Based on the thread and the partner rate sheet", review: "A rate below the partner sheet needs Owner approval" },
  { channel: "whatsapp", via: "phone", subject: "Call note: 18-person team offsite, 4-6 Dec", unread: 0,
    msgs: [
      ["lead", 3300, "Call: Admin head asked for a 2-night offsite for 18 people, 4 to 6 December, needs a room for sessions and a projector."],
      ["us", 3280, "Call: Said we have a covered terrace and the Dorm loft; will send a quote with meals included. GST invoice needed."],
    ],
    draft: `Hello ${first}, as discussed on the call: 2 nights, 4 to 6 December, 18 guests. Proposed: Dorm loft (8) plus 5 rooms, all meals, terrace for sessions with a projector and screen. Estimated Rs 1,26,000 plus 12% GST (rooms above Rs 7,500 per night are taxed higher: we will confirm on the invoice). 30% advance to confirm. Shall I send the detailed quote by email?`,
    why: ["Corporate group with GST invoice requirement", "Terrace and projector mentioned on call", "Advance 30% for group bookings"], basedOn: "Based on call notes from Tuesday and the group tariff", review: "Tax rate wording needs Owner confirmation before it goes out" },
  { channel: "email", subject: "Pre-wedding events: 2 days in December", unread: 1,
    msgs: [
      ["lead", 4400, "Hello, I am a wedding planner from Kochi. Our couple wants a 2-day pre-wedding (mehendi and sangeet) for about 45 guests in the second week of December. Is the lawn available, and what is the minimum room commitment?"],
      ["us", 4300, "Hello, thank you for writing. The lawn is available for events in December; I am checking the minimum room block with the owner."],
      ["lead", 700, "Also, can your kitchen manage a Kerala-style lunch if we bring our caterer?"],
    ],
    draft: `Dear ${first}, thank you for your patience. For a pre-wedding of about 45 guests we suggest blocking 14 rooms or the Dorm loft plus 8 rooms. Lawn use for the two days is Rs 25,000 per day. Your caterer is welcome (kitchen access for 3 hours; a Rs 8,000 cleaning fee applies). A 50% advance holds the dates. I will send the draft agreement after the owner confirms the sound limit (10 pm).`,
    why: ["Event enquiry: minimum block and lawn fee from the event sheet", "Outside caterer policy on file", "Sound limit applies at the property"], basedOn: "Based on 3 emails and the events sheet", review: "Event pricing and policy need Owner review before sending" },
  { channel: "whatsapp", subject: "அட்வான்ஸ் செலுத்தப்பட்டது", unread: 1,
    msgs: [
      ["us", 1500, "வணக்கம்! உங்கள் அறை 48 மணி நேரம் பிடிக்கப்பட்டுள்ளது. இதோ Razorpay இணைப்பு."],
      ["lead", 70, "அட்வான்ஸ் ரூ 9,600 அனுப்பியிருக்கிறேன். Screenshot அனுப்புகிறேன்."],
      ["lead", 69, "[Payment screenshot]"],
    ],
    draft: `நன்றி ${first}! ரூ 9,600 அட்வான்ஸ் கிடைத்தது. உங்கள் முன்பதிவு உறுதி செய்யப்பட்டது. வரும் நாள் மதியம் 12 மணிக்குப் பிறகு check-in. வழி விவரம் மற்றும் parking தகவல் இங்கே அனுப்புகிறேன்.`,
    why: ["Advance paid by the guest, screenshot shared", "Razorpay should show the payment: confirm before replying", "Next step: confirmation and directions"], basedOn: "Based on the thread and the Razorpay payment link record", review: "Confirm the payment in Razorpay before sending the booking confirmation" },
  { channel: "whatsapp", subject: "Pets allowed?", unread: 0,
    msgs: [["lead", 260, "Hi, we have a labrador (2 years old). Can we bring him for the weekend of 24 Oct?"]],
    draft: `Hello ${first}, thanks for asking. Small, well-behaved pets are allowed in the Garden Cottages (ground floor, private sit-out) for Rs 500 per night. We would need his vaccination card at check-in. Shall I check the cottage for 24 and 25 October?`,
    why: ["Pet question: policy in the house rules sheet", "Garden Cottage is the only pet-friendly room type"], basedOn: "Based on 1 WhatsApp message and the house rules", review: "Pet policy and fee are Owner decisions: confirm they are current" },
  { channel: "whatsapp", via: "instagram", subject: "Workation: wifi and desk, 5 nights", unread: 1,
    msgs: [
      ["lead", 330, "Hi, I work remotely (calls all day). Is your wifi reliable? Looking for 5 nights next week, Mon to Fri."],
      ["lead", 328, "And is there a proper desk in the room?"],
    ],
    draft: `Hi ${first}, we have fibre broadband (about 100 Mbps) with a backup connection for power cuts. Valley-view Room has a desk by the window. The workation rate is Rs 3,900 per night for Monday to Thursday stays of 4+ nights, so 5 nights would be Rs 19,500 with breakfast. Want me to block it?`,
    why: ["Workation offer applies (4+ nights, Mon-Thu)", "Speed figure from the property sheet", "Desk in Valley-view Room"], basedOn: "Based on 2 Instagram messages and the workation offer sheet", review: "5 nights run through Friday: confirm the offer applies to the full stay" },
  { channel: "whatsapp", subject: "Change of dates: shift by 2 days", unread: 1,
    msgs: [
      ["us", 6000, "Your booking is confirmed. Advance received with thanks."],
      ["lead", 90, "Sorry, our plans changed. Can we shift everything by 2 days later? Same room."],
    ],
    draft: `Hello ${first}, thank you for telling us early. Two days later the same room is available. If the new dates fall in a festival window the nightly rate can be higher; I will share the exact difference, and your advance carries over. I will update the booking once Kavitha approves the change.`,
    why: ["Date change after advance", "Rate difference depends on the festival calendar", "Policy: one free date change up to 30 days before arrival"], basedOn: "Based on 2 messages and the booking record", review: "Date changes and rate differences need Owner approval" },
  { channel: "whatsapp", via: "phone", subject: "Call note: repeat guest, New Year in the same cottage", unread: 0,
    msgs: [
      ["lead", 5000, "Call: Mrs. said they stayed in Garden Cottage 2 last New Year and want the same one, 30 Dec to 2 Jan, 4 adults."],
      ["us", 4980, "Call: Said we will check. Garden Cottage 2 is booked 31 Dec; offered Garden Cottage 4 with the same view."],
    ],
    draft: `Hello ${first}, thank you for coming back to Shola Mist. Garden Cottage 2 is taken for 31 December, but Garden Cottage 4 has the same view of the valley and is free for 30 December to 2 January. 3 nights at the New Year rate is Rs 5,000 per night (Rs 15,000) with the repeat-guest 10% off, so Rs 13,500. Shall I hold it?`,
    why: ["Repeat guest: 10% repeat discount applied", "Nearest equivalent cottage offered", "New Year festival uplift in the rate"], basedOn: "Based on call notes and last year's stay record" },
  { channel: "whatsapp", subject: "GST invoice for the company stay", unread: 0,
    msgs: [["lead", 800, "Please share a GST invoice for our stay last week. Company name and GSTIN below. [Details shared]"]],
    draft: `Hello ${first}, thank you for the details. We will issue the invoice in your company name and GSTIN and send it as a PDF on email and here by tomorrow noon. Please confirm the billing address is the same as on the GST certificate.`,
    why: ["Invoice request with GSTIN shared", "Accounts is handled by the owner"], basedOn: "Based on 1 WhatsApp message", review: "Invoice details need the owner's accounts check" },
  { channel: "whatsapp", subject: "வழி மற்றும் pickup", unread: 1,
    msgs: [
      ["lead", 150, "வணக்கம், நாங்கள் ரயிலில் Mettupalayam வருகிறோம் சனிக்கிழமை காலை. அங்கிருந்து Coonoor வர pickup கிடைக்குமா?"],
      ["lead", 148, "5 பேர், 3 luggage"],
    ],
    draft: `வணக்கம் ${first}, Mettupalayam station-இலிருந்து pickup ஏற்பாடு செய்யலாம். 5 பேர் மற்றும் luggage-க்கு பெரிய வாகனம் தேவை, கட்டணம் ரூ 1,800 (சுமார் 1 மணி 15 நிமிடம் பயணம்). ரயில் எண் மற்றும் வரும் நேரத்தை அனுப்புங்கள்.`,
    why: ["Pickup request from Mettupalayam", "Party of 5 with luggage: larger vehicle", "Fee from the transfer list"], basedOn: "Based on 2 WhatsApp messages and the local transfer list", review: "Transfer fee is quoted by an outside driver: confirm before sending" },
  { channel: "email", subject: "Cancellation and refund request", unread: 0,
    msgs: [
      ["lead", 2600, "Due to a family emergency we need to cancel our booking for our upcoming stay. Please advise on the refund of our advance."],
      ["us", 2400, "We are sorry to hear this. I am checking the cancellation policy with the owner and will respond today."],
    ],
    draft: `Dear ${first}, we are sorry to hear about the emergency. Under our policy, cancellations 14 or more days before arrival are refunded 70% of the advance; the balance can be kept as a credit valid for 12 months. As your arrival is more than 14 days away, you qualify for the 70% refund, processed to the original payment method in 5 to 7 working days. I will confirm once the owner approves.`,
    why: ["Cancellation more than 14 days before arrival", "Policy tier: 14+ days, 70% refund", "Compassionate credit option available"], basedOn: "Based on 2 emails and the cancellation policy", review: "Refunds always need Owner approval" },
];

export function buildHospitalityConversations(leads: Lead[], accounts: Account[], deals: Deal[]): Conversation[] {
  const accKind = (l: Lead) => accounts.find((a) => a.id === l.accountId)?.guestKind;
  const hasDeal = new Set(deals.map((d) => d.leadId));
  const taken = new Set<string>();
  const pick = (pred: (l: Lead) => boolean, fallback: number) => {
    let l = leads.find((x) => !taken.has(x.id) && pred(x));
    if (!l) { let i = fallback; while (taken.has(leads[i % leads.length].id)) i++; l = leads[i % leads.length]; }
    taken.add(l.id); return l;
  };
  const dealOf = (l: Lead) => deals.find((d) => d.leadId === l.id);
  const open = (l: Lead) => !hasDeal.has(l.id) && l.stage !== "won" && l.stage !== "lost";
  const picks: Lead[] = [
    pick((l) => open(l) && l.stage !== "new" && l.campaignId === "cmp-wg-pongal", 3),
    pick((l) => open(l) && l.campaignId === "cmp-wg-diwali", 8),
    pick((l) => open(l) && l.city === "Bengaluru" && l.stay?.tripType === "Couples", 12),
    pick((l) => open(l) && accKind(l) === "travel_agent", 15),
    pick((l) => accKind(l) === "corporate", 20),
    pick((l) => accKind(l) === "wedding_planner", 25),
    pick((l) => l.stage === "demo_done", 30),
    pick((l) => open(l) && l.stay?.tripType === "Family" && l.stage === "contacted", 35),
    pick((l) => open(l) && l.stay?.tripType === "Workation", 40),
    pick((l) => l.stage === "won" && (dealOf(l)?.stay?.checkIn ?? "") > "2026-10-20", 45),
    pick((l) => open(l) && l.stay?.origin === "repeat" && l.stay.tripType === "Couples", 50),
    pick((l) => l.stage === "won" && accKind(l) === "corporate", 55),
    pick((l) => l.stage === "won" && (dealOf(l)?.stay?.checkIn ?? "") > "2026-10-14" && (dealOf(l)?.stay?.checkIn ?? "") < "2026-11-20", 60),
    pick((l) => l.stage === "lost" && !!dealOf(l), 65),
  ];
  // Anchor details so the thread and the record agree (only on leads that have no booking record).
  const anchor = (l: Lead, patch: Partial<NonNullable<Lead["stay"]>>, title?: string) => {
    if (hasDeal.has(l.id) || !l.stay) return;
    l.stay = { ...l.stay, ...patch }; if (title) l.title = title;
  };
  anchor(picks[0], { checkIn: "2027-01-14", nights: 3, guests: 5, rooms: 2, room: "Family Suite", tripType: "Family", occasion: "Pongal" }, "Family trip, 5 guests");
  anchor(picks[1], { checkIn: "2026-11-06", nights: 3, guests: 4, rooms: 2, room: "Garden Cottage", occasion: "Diwali" });
  anchor(picks[2], { checkIn: "2026-10-17", nights: 2, guests: 2, rooms: 1, room: "Valley-view Room" }, "Couple's getaway, 2 guests");
  const seen = new Set<string>();
  return picks.map((l, i) => [l, i] as const).filter(([l]) => l && !seen.has(l.id) && seen.add(l.id)).map(([l, i]) => {
    const t = T(l.name.split(" ")[0])[i];
    const messages: Message[] = t.msgs.map(([from, ago, body], j) => ({
      id: `m-${i}-${j}`, from, at: iso(NOW_MS - ago * MIN), body, authorId: from === "us" ? l.ownerId : undefined,
      status: from === "us" ? (j < t.msgs.length - 1 ? "read" : "delivered") : undefined,
    }));
    return {
      id: `CV-${71 + i}`, leadId: l.id, channel: t.channel, via: t.via, subject: t.subject, unread: t.unread,
      lastAt: messages[messages.length - 1].at, messages,
      aiDraft: { body: t.draft, rationale: t.why, basedOn: t.basedOn, needsReview: t.review },
    } satisfies Conversation;
  }).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}
