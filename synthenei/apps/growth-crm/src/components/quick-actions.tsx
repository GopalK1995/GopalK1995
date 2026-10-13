"use client";
import { CalendarPlus, MessageCircle, Phone } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Gate } from "@/components/ui/gate";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/components/shell/providers";
import { can } from "@/lib/auth/roles";

const field = "h-9 w-full rounded-sm border border-line-strong bg-surface px-2.5 text-[13px] outline-none focus:border-ring";
const Lbl = ({ t, children }: { t: string; children: ReactNode }) => <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{t}</span>{children}</label>;

export const WA_TEMPLATES = [
  { id: "ecourts_intro_ta", lang: "Tamil", body: "வணக்கம் {{1}}, LAWSOME உங்கள் Madras High Court மற்றும் மாவட்ட நீதிமன்ற வழக்குகளின் அடுத்த விசாரணை தேதிகளை காலை 7 மணிக்கு அனுப்பும். டெமோ பார்க்க DEMO என பதில் அனுப்பவும்." },
  { id: "demo_reminder_en", lang: "English", body: "Hi {{1}}, a reminder of your LAWSOME demo on {{2}}. The Meet link is in your email. Reply 1 to confirm or 2 to reschedule." },
  { id: "proposal_followup_en", lang: "English", body: "Hi {{1}}, sharing the annual proposal for {{2}} again. Happy to walk your partners through it this week." },
];

type Target = { leadName?: string; firm?: string };
/** Optional server action / handler; without it the dialog only shows a demo toast. */
type Submit = (data: FormData) => void | Promise<void>;
export function LogCallDialog({ onSubmit, t, trigger }: { t?: Target; trigger: ReactNode; onSubmit?: Submit }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Log a call" description={t?.leadName ? `${t.leadName}${t.firm ? ` · ${t.firm}` : ""}` : "Pick the lead after logging if you called from your phone."}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setOpen(false); void onSubmit?.(new FormData(e.currentTarget)); toast(`Call logged${t?.leadName ? ` for ${t.leadName}` : ""}`, "Demo: added to the timeline for this session only."); }}>
          <div className="grid grid-cols-2 gap-3">
            <Lbl t="Outcome"><select name="outcome" className={field} defaultValue="Connected">{["Connected", "No answer", "Busy", "Wrong number", "Call back later"].map((o) => <option key={o}>{o}</option>)}</select></Lbl>
            <Lbl t="Duration (min)"><input name="duration_min" className={field} type="number" min={0} defaultValue={6} /></Lbl>
          </div>
          <Lbl t="Notes"><textarea name="notes" className={field + " h-20 py-2"} defaultValue="Discussed cause-list alerts for Madras HC matters; partner wants Tamil walkthrough." /></Lbl>
          <Lbl t="Next step date"><input name="next_step_at" className={field} type="date" defaultValue="2026-10-15" /></Lbl>
          <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary">Save call</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WhatsAppDialog({ onSubmit, t, trigger, consent = true }: { t?: Target; trigger: ReactNode; consent?: boolean; onSubmit?: Submit }) {
  const [open, setOpen] = useState(false);
  const [tpl, setTpl] = useState(WA_TEMPLATES[0].id);
  const cur = WA_TEMPLATES.find((x) => x.id === tpl)!;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Send WhatsApp template" description="Showcase: messages are simulated (status 'simulated'), nothing reaches WhatsApp.">
        {!consent ? <p className="rounded-sm bg-warn-soft px-3 py-2 text-[13px] text-warn-ink">This lead has not opted in to WhatsApp. Templates are blocked until consent is recorded.</p> : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setOpen(false); void onSubmit?.(new FormData(e.currentTarget)); toast(`Template ${tpl} queued${t?.leadName ? ` to ${t.leadName}` : ""}`, "Showcase: simulated, not sent."); }}>
            <Lbl t="Approved template"><select name="template" className={field} value={tpl} onChange={(e) => setTpl(e.target.value)}>{WA_TEMPLATES.map((x) => <option key={x.id} value={x.id}>{x.id} ({x.lang})</option>)}</select></Lbl>
            <div className="rounded-md border border-line bg-paper p-3 text-[13px] leading-5 text-ink-2">{cur.body.replace("{{1}}", t?.leadName?.split(" ")[0] ?? "Saravanan").replace("{{2}}", t?.firm ?? "Thu 15 Oct, 5:30 pm")}</div>
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary">Send (simulated)</Button></div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ScheduleDemoDialog({ onSubmit, t, trigger }: { t?: Target; trigger: ReactNode; onSubmit?: Submit }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Schedule a demo" description={t?.firm ? `${t.firm} · times in IST` : "Times in IST"}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setOpen(false); void onSubmit?.(new FormData(e.currentTarget)); toast(`Demo scheduled${t?.firm ? ` with ${t.firm}` : ""}`, "Demo: task created and deal moved to Demo scheduled for this session only."); }}>
          <div className="grid grid-cols-2 gap-3">
            <Lbl t="Date"><input name="date" className={field} type="date" defaultValue="2026-10-15" /></Lbl>
            <Lbl t="Time"><input name="time" className={field} type="time" defaultValue="17:30" /></Lbl>
            <Lbl t="Duration"><select name="duration" className={field}><option>30 min</option><option>45 min</option></select></Lbl>
            <Lbl t="Mode"><select name="mode" className={field}><option>Google Meet</option><option>In person at firm</option><option>Phone</option></select></Lbl>
          </div>
          <p className="text-[12px] text-ink-3">Most partners prefer after 5:30 pm on weekdays or Saturday mornings (court hours 10:30–17:00).</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary">Schedule</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function QuickActions({ t, size = "md", consent = true }: { t?: Target; size?: "sm" | "md"; consent?: boolean }) {
  const { role, support } = useSession();
  const call = <Button size={size}><Phone />Log call</Button>;
  const wa = <Button size={size}><MessageCircle />WhatsApp template</Button>;
  const demo = <Button size={size} variant="primary"><CalendarPlus />Schedule demo</Button>;
  if (!can("workLeads", { role, support })) return <div className="flex flex-wrap gap-2"><Gate can="workLeads">{call}</Gate><Gate can="workLeads">{wa}</Gate><Gate can="workLeads">{demo}</Gate></div>;
  return (
    <div className="flex flex-wrap gap-2">
      <LogCallDialog t={t} trigger={call} />
      <WhatsAppDialog t={t} consent={consent} trigger={wa} />
      <ScheduleDemoDialog t={t} trigger={demo} />
    </div>
  );
}
