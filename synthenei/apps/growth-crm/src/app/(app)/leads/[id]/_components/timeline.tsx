"use client";
// Activity timeline merging activities, web events and messages (spec 5 /leads/[id]) with a type filter.
import { useState } from "react";
import { CalendarCheck, Globe, Mail, MessageCircle, Phone, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type TimelineCat = "call" | "whatsapp" | "email" | "meeting" | "web" | "system";
export type TimelineItem = { id: string; at: string; when: string; day: string; cat: TimelineCat; title: string; detail?: string; by?: string; inbound?: boolean };
const CATS: { key: "all" | TimelineCat; label: string }[] = [
  { key: "all", label: "All" }, { key: "call", label: "Calls" }, { key: "whatsapp", label: "WhatsApp" }, { key: "email", label: "Email" },
  { key: "meeting", label: "Meetings" }, { key: "web", label: "Web events" }, { key: "system", label: "System" },
];
const ICON: Record<TimelineCat, typeof Phone> = { call: Phone, whatsapp: MessageCircle, email: Mail, meeting: CalendarCheck, web: Globe, system: Settings2 };

export function Timeline({ items }: { items: TimelineItem[] }) {
  const [cat, setCat] = useState<"all" | TimelineCat>("all");
  const [more, setMore] = useState(false);
  const shown = items.filter((i) => cat === "all" || i.cat === cat);
  const list = more ? shown : shown.slice(0, 14);
  let lastDay = "";
  return (
    <div>
      <div role="radiogroup" aria-label="Filter timeline" className="scrollbar-thin -mx-4 flex gap-1 overflow-x-auto px-4 pb-3 sm:-mx-5 sm:px-5">
        {CATS.map((c) => {
          const n = c.key === "all" ? items.length : items.filter((i) => i.cat === c.key).length;
          return (
            <button key={c.key} type="button" role="radio" aria-checked={cat === c.key} onClick={() => setCat(c.key)} disabled={!n && c.key !== "all"}
              className={cn("inline-flex h-8 shrink-0 items-center gap-1 rounded-sm border px-2.5 text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
                cat === c.key ? "border-accent bg-accent-soft text-accent-strong" : "border-line-strong bg-surface text-ink-2 hover:text-ink")}>
              {c.label}<span className="num text-[11px] opacity-70">{n}</span>
            </button>
          );
        })}
      </div>
      {!list.length ? (
        <p className="rounded-md border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-ink-3">Nothing of this type yet.</p>
      ) : (
        <ol className="relative">
          {list.map((i) => {
            const I = ICON[i.cat];
            const header = i.day !== lastDay; lastDay = i.day;
            return (
              <li key={i.id}>
                {header && <div className="eyebrow mb-2 mt-3 first:mt-0">{i.day}</div>}
                <div className="grid grid-cols-[28px_1fr] gap-3 pb-3">
                  <span className={cn("mt-0.5 grid size-7 place-items-center rounded-sm border", i.inbound ? "border-accent/30 bg-accent-soft text-accent-strong" : "border-line bg-paper text-ink-3")}>
                    <I className="size-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 border-b border-line pb-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 text-[13px] font-medium text-ink">{i.title}</span>
                      <time dateTime={i.at} className="shrink-0 text-[12px] text-ink-3 num">{i.when}</time>
                    </div>
                    {i.detail && <p className="mt-0.5 whitespace-pre-line text-[13px] leading-5 text-ink-2">{i.detail}</p>}
                    {i.by && <p className="mt-0.5 text-[12px] text-ink-3">{i.by}</p>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {shown.length > 14 && (
        <button type="button" onClick={() => setMore((m) => !m)} className="text-[13px] font-medium text-accent hover:underline">{more ? "Show fewer" : `Show all ${shown.length}`}</button>
      )}
    </div>
  );
}
