// Copilot canned answers for the Shola Mist workspace, computed from the dataset so they always agree with the screens.
// The Ask CRM page (UI-owned) can call hospitalityCopilot(ds) and render { id, question, answer, bullets }.
import type { Dataset } from "../types";
import { NOW_MS } from "./seed";

const inr = (n: number) => "Rs " + Math.round(n).toLocaleString("en-IN");
const DAY = 86400e3;
export interface CopilotAnswer { id: string; question: string; answer: string; bullets: string[] }

export function hospitalityCopilot(ds: Dataset): CopilotAnswer[] {
  const today = new Date(NOW_MS + 5.5 * 3600e3).toISOString().slice(0, 10);
  const end30 = new Date(NOW_MS + 5.5 * 3600e3 + 30 * DAY).toISOString().slice(0, 10);
  const booked = ds.deals.filter((d) => d.stage === "won" && d.stay);
  // Room-nights sold in the next 30 days out of 14 rooms x 30 nights (CRM bookings only; OTA-only stays are not in this sample).
  let sold = 0;
  for (const d of booked) {
    const s = d.stay!;
    for (let i = 0; i < s.nights; i++) {
      const night = new Date(new Date(s.checkIn + "T12:00:00Z").getTime() + i * DAY).toISOString().slice(0, 10);
      if (night >= today && night < end30) sold += s.rooms;
    }
  }
  const nightsRooms = (from: string, to: string) => { let n = 0; for (const d of booked) for (let i = 0; i < d.stay!.nights; i++) { const night = new Date(new Date(d.stay!.checkIn + "T12:00:00Z").getTime() + i * DAY).toISOString().slice(0, 10); if (night >= from && night <= to) n += d.stay!.rooms; } return n; };
  const diwali = Math.round((nightsRooms("2026-11-07", "2026-11-09") / (14 * 3)) * 100);
  const occ = Math.round((sold / (14 * 30)) * 100);
  const bySource = new Map<string, number>();
  ds.leads.forEach((l) => { const k = l.campaignId ? ds.campaigns.find((c) => c.id === l.campaignId)?.name ?? l.channel : l.channel === "whatsapp" ? "Direct WhatsApp" : l.channel === "referral" ? "Word of mouth / past guests" : "Google organic / profile"; bySource.set(k, (bySource.get(k) ?? 0) + 1); });
  const srcRows = [...bySource.entries()].sort((a, b) => b[1] - a[1]);
  const spend = ds.campaignDays.reduce((a, d) => a + d.spend, 0);
  const paidLeadIds = new Set(ds.leads.filter((l) => l.campaignId).map((l) => l.id));
  const paidBookings = booked.filter((d) => paidLeadIds.has(d.leadId));
  const perCmp = ds.campaigns.map((c) => {
    const sp = ds.campaignDays.filter((d) => d.campaignId === c.id).reduce((a, d) => a + d.spend, 0);
    const ls = new Set(ds.leads.filter((l) => l.campaignId === c.id).map((l) => l.id));
    const won = booked.filter((d) => ls.has(d.leadId));
    return { c, sp, leads: ls.size, won: won.length, rev: won.reduce((a, d) => a + d.value, 0) };
  }).filter((x) => x.sp > 0 && x.rev > 0).sort((a, b) => b.rev / b.sp - a.rev / a.sp);
  const best = perCmp[0];
  const due = ds.tasks.filter((t) => t.status === "open" && new Date(t.dueAt).getTime() <= NOW_MS + DAY);
  const direct = booked.filter((d) => !d.stay!.viaOta);
  return [
    { id: "occupancy", question: "What is our occupancy for the next 30 days?", answer: `About ${occ}% of room-nights are booked through this CRM for the next 30 days (${sold} of ${14 * 30}).`,
      bullets: [`${booked.filter((d) => d.stay!.checkIn >= today).length} confirmed upcoming stays`, `Diwali weekend (7-9 Nov): ${diwali}% booked`, "Counts bookings recorded here; walk-ins and OTA-only stays are added by the channel-manager sync", "Festival weeks (Diwali, Christmas, Pongal) fill first"] },
    { id: "sources", question: "Where do our enquiries come from?", answer: `${ds.leads.length} enquiries in 90 days. Top source: ${srcRows[0][0]} (${srcRows[0][1]}).`, bullets: srcRows.slice(0, 5).map(([k, n]) => `${k}: ${n}`) },
    { id: "cost-per-booking", question: "What is our cost per booking?", answer: `${inr(spend)} ad spend over 90 days and ${paidBookings.length} bookings from paid campaigns: ${paidBookings.length ? inr(spend / paidBookings.length) : "n/a"} per booking.`,
      bullets: [`Average booking value ${inr(booked.reduce((a, d) => a + d.value, 0) / Math.max(1, booked.length))}`, `Direct bookings: ${Math.round((direct.length / Math.max(1, booked.length)) * 100)}% of all bookings (OTA pays commission)`] },
    { id: "best-campaign", question: "Which campaign is working best?", answer: best ? `${best.c.name}: ${inr(best.rev)} booked from ${inr(best.sp)} spend (${(best.rev / best.sp).toFixed(1)}x).` : "Not enough bookings to rank campaigns yet.",
      bullets: perCmp.slice(0, 4).map((x) => `${x.c.name}: ${x.leads} enquiries, ${x.won} bookings, ${inr(x.rev)}`) },
    { id: "follow-ups", question: "Whom should we follow up today?", answer: `${due.length} follow-ups are due today or overdue.`,
      bullets: due.slice(0, 5).map((t) => `${t.title}${t.leadId ? ` (${ds.leads.find((l) => l.id === t.leadId)?.name ?? ""})` : ""}`) },
  ];
}
