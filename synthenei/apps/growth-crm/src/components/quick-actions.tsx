"use client";
import { CalendarPlus, MessageCircle, Phone } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Gate } from "@/components/ui/gate";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/components/shell/providers";
import { can } from "@/lib/auth/roles";
import { useVocab } from "@/components/shell/providers";

const field = "h-9 w-full rounded-sm border border-line-strong bg-surface px-2.5 text-[13px] outline-none focus:border-ring";
const Lbl = ({ t, children }: { t: string; children: ReactNode }) => <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{t}</span>{children}</label>;


type Target = { leadName?: string; firm?: string };
/** Optional server action / handler; without it the dialog only shows a demo toast. */
type Submit = (data: FormData) => void | Promise<void>;
export function LogCallDialog({ onSubmit, t, trigger }: { t?: Target; trigger: ReactNode; onSubmit?: Submit }) {
  const q = useVocab().qa;
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
          <Lbl t="Notes"><textarea name="notes" className={field + " h-20 py-2"} defaultValue={q.callDefault} /></Lbl>
          <Lbl t="Next step date"><input name="next_step_at" className={field} type="date" defaultValue="2026-10-15" /></Lbl>
          <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary">Save call</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WhatsAppDialog({ onSubmit, t, trigger, consent = true }: { t?: Target; trigger: ReactNode; consent?: boolean; onSubmit?: Submit }) {
  const [open, setOpen] = useState(false);
  const vv = useVocab(), WA = vv.waQuick.length ? vv.waQuick : vv.wa, q = vv.qa;
  const [tpl, setTpl] = useState(WA[0].id);
  const cur = WA.find((x) => x.id === tpl) ?? WA[0];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Send WhatsApp template" description="Showcase: messages are simulated (status 'simulated'), nothing reaches WhatsApp.">
        {!consent ? <p className="rounded-sm bg-warn-soft px-3 py-2 text-[13px] text-warn-ink">{q.consentMsg}</p> : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setOpen(false); void onSubmit?.(new FormData(e.currentTarget)); toast(`Template ${tpl} queued${t?.leadName ? ` to ${t.leadName}` : ""}`, "Showcase: simulated, not sent."); }}>
            <Lbl t="Approved template"><select name="template" className={field} value={tpl} onChange={(e) => setTpl(e.target.value)}>{WA.map((x) => <option key={x.id} value={x.id}>{x.id} ({x.lang})</option>)}</select></Lbl>
            <div className="rounded-md border border-line bg-paper p-3 text-[13px] leading-5 text-ink-2">{cur.body.replace("{{1}}", t?.leadName?.split(" ")[0] ?? q.waName).replace("{{2}}", t?.firm ?? q.waSlot)}</div>
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary">Send (simulated)</Button></div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ScheduleDemoDialog({ onSubmit, t, trigger }: { t?: Target; trigger: ReactNode; onSubmit?: Submit }) {
  const q = useVocab().qa;
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={q.demoTitle} description={t?.firm ? `${t.firm} · times in IST` : "Times in IST"}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setOpen(false); void onSubmit?.(new FormData(e.currentTarget)); toast(q.demoToast(t?.firm ?? ""), q.demoToastSub); }}>
          <div className="grid grid-cols-2 gap-3">
            <Lbl t="Date"><input name="date" className={field} type="date" defaultValue="2026-10-15" /></Lbl>
            <Lbl t="Time"><input name="time" className={field} type="time" defaultValue="17:30" /></Lbl>
            <Lbl t="Duration"><select name="duration" className={field}><option>30 min</option><option>45 min</option></select></Lbl>
            <Lbl t="Mode"><select name="mode" className={field}>{q.demoModes.map((m) => <option key={m}>{m}</option>)}</select></Lbl>
          </div>
          <p className="text-[12px] text-ink-3">{q.demoNote}</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary">Schedule</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function QuickActions({ t, size = "md", consent = true }: { t?: Target; size?: "sm" | "md"; consent?: boolean }) {
  const { role, support } = useSession();
  const q = useVocab().qa;
  const call = <Button size={size}><Phone />Log call</Button>;
  const wa = <Button size={size}><MessageCircle />WhatsApp template</Button>;
  const demo = <Button size={size} variant="primary"><CalendarPlus />{q.demoBtn}</Button>;
  if (!can("workLeads", { role, support })) return <div className="flex flex-wrap gap-2"><Gate can="workLeads">{call}</Gate><Gate can="workLeads">{wa}</Gate><Gate can="workLeads">{demo}</Gate></div>;
  return (
    <div className="flex flex-wrap gap-2">
      <LogCallDialog t={t} trigger={call} />
      <WhatsAppDialog t={t} consent={consent} trigger={wa} />
      <ScheduleDemoDialog t={t} trigger={demo} />
    </div>
  );
}
