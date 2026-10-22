"use client";
// Lead actions (spec 5 /leads/[id]): log call, WhatsApp template (showcase), email, schedule demo, change status, assign.
// Each button is hidden for roles that cannot act and disabled in a support session; the server action re-checks both.
import { useState, useTransition, type ReactNode } from "react";
import { CalendarPlus, ChevronDown, Mail, MessageCircle, Phone, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/dropdown";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { assignLeads, changeStatus, logCall, logEmail, scheduleDemo, sendWhatsApp } from "../../actions";
import { CALL_OUTCOMES, field, type Result } from "../../_lib/sales";
import { useSession, useVocab } from "@/components/shell/providers";
import { Gate } from "@/components/ui/gate";
import { usePerm } from "../../_components/perm";

type LeadInfo = { id: string; name: string; firm: string; email: string; consentWa: boolean; ownerId: string | null; today: string; tomorrow: string };
const Lbl = ({ t, children, className }: { t: string; children: ReactNode; className?: string }) => (
  <label className={cn("block", className)}><span className="mb-1 block text-[12px] font-medium text-ink-2">{t}</span>{children}</label>
);
const Foot = ({ onCancel, label, pending, disabled }: { onCancel: () => void; label: string; pending: boolean; disabled?: boolean }) => (
  <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button><Button variant="primary" disabled={pending || disabled}>{label}</Button></div>
);

export function LeadActions({ lead, owners }: { lead: LeadInfo; owners: { id: string; name: string }[] }) {
  const [dlg, setDlg] = useState<null | "call" | "wa" | "email" | "demo" | "dq">(null);
  const [pending, start] = useTransition();
  const work = usePerm("workLeads"), assign = usePerm("assignLeads");
  const vv = useVocab(), la = vv.la, WA_TEMPLATES = vv.wa, tenantName = useSession().tenant.name;
  const STATUSES = [["new", "New"], ["contacted", "Contacted"], ["qualified", "Qualified"], ["nurturing", "Nurturing"], ["converted", la.converted]] as const;
  const DQ = vv.ls.a.dq;
  const [tpl, setTpl] = useState<string>(WA_TEMPLATES[0].id);
  const [err, setErr] = useState<string | null>(null);
  const close = () => { setDlg(null); setErr(null); };
  const run = (fn: () => Promise<Result>, after?: () => void) => start(async () => {
    const r = await fn();
    if (!r.ok) { setErr(r.message); toast(r.message, "Nothing was changed."); return; }
    toast(r.message, r.sub); close(); after?.();
  });
  const first = lead.name.split(" ")[0];
  const cur = WA_TEMPLATES.find((x) => x.id === tpl) ?? WA_TEMPLATES[0];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Gate can="workLeads"><Button variant="primary" onClick={() => setDlg("call")}><Phone />Log call</Button></Gate>
      <Gate can="workLeads"><Button onClick={() => setDlg("wa")}><MessageCircle />WhatsApp</Button></Gate>
      <Gate can="workLeads"><Button onClick={() => setDlg("email")}><Mail />Email</Button></Gate>
      <Gate can="workLeads"><Button onClick={() => setDlg("demo")}><CalendarPlus />{la.demoBtn}</Button></Gate>
      {work === "support" && <Gate can="workLeads"><Button variant="ghost">Status<ChevronDown /></Button></Gate>}
      {work === "yes" && (
        <Menu>
          <MenuTrigger asChild><Button variant="ghost">Status<ChevronDown /></Button></MenuTrigger>
          <MenuContent align="start">
            <MenuLabel>{la.statusLabel}</MenuLabel>
            {STATUSES.map(([k, l]) => <MenuItem key={k} onSelect={() => run(() => changeStatus(lead.id, k))}>{l}</MenuItem>)}
            <MenuItem onSelect={() => setDlg("dq")} className="text-danger">Disqualify…</MenuItem>
          </MenuContent>
        </Menu>
      )}
      {assign === "support" && <Gate can="assignLeads"><Button variant="ghost"><UserRoundCheck />Assign<ChevronDown /></Button></Gate>}
      {assign === "yes" && (
        <Menu>
          <MenuTrigger asChild><Button variant="ghost"><UserRoundCheck />Assign<ChevronDown /></Button></MenuTrigger>
          <MenuContent align="start">
            <MenuLabel>Assign to</MenuLabel>
            {owners.map((o) => <MenuItem key={o.id} onSelect={() => run(() => assignLeads([lead.id], o.id))}>{o.name}{o.id === lead.ownerId ? " (current)" : ""}</MenuItem>)}
          </MenuContent>
        </Menu>
      )}

      <Dialog open={dlg === "call"} onOpenChange={(o) => !o && close()}>
        <DialogContent title="Log a call" description={`${lead.name} · ${lead.firm}`}>
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            run(() => logCall(lead.id, { outcome: String(f.get("outcome")), minutes: Number(f.get("minutes")), notes: String(f.get("notes") ?? ""), nextDate: String(f.get("next") ?? "") }));
          }}>
            <div className="grid grid-cols-2 gap-3">
              <Lbl t="Outcome"><select name="outcome" className={field} defaultValue="connected">{CALL_OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></Lbl>
              <Lbl t="Duration (min)"><input name="minutes" className={field} type="number" min={0} max={240} defaultValue={4} /></Lbl>
            </div>
            <Lbl t="Notes"><textarea name="notes" className={cn(field, "h-20 py-2")} placeholder={la.callPh} /></Lbl>
            <Lbl t="Next step date (creates a follow-up task)"><input name="next" className={field} type="date" defaultValue={lead.tomorrow} min={lead.today} /></Lbl>
            {err && <p role="alert" className="text-[12px] text-danger">{err}</p>}
            <Foot onCancel={close} label="Save call" pending={pending} />
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "wa"} onOpenChange={(o) => !o && close()}>
        <DialogContent title="Send WhatsApp template" description="Showcase: the message is logged with status 'simulated'. Nothing reaches WhatsApp until the Cloud API is connected.">
          {!lead.consentWa ? (
            <p className="rounded-sm bg-warn-soft px-3 py-2 text-[13px] text-warn-ink">{la.noWa(lead.name)}</p>
          ) : (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => sendWhatsApp(lead.id, tpl)); }}>
              <Lbl t="Approved template"><select className={field} value={tpl} onChange={(e) => setTpl(e.target.value)}>{WA_TEMPLATES.map((x) => <option key={x.id} value={x.id}>{x.id} ({x.lang})</option>)}</select></Lbl>
              <div className="rounded-md border border-line bg-paper p-3 text-[13px] leading-5 text-ink-2" lang={cur.lang === "Tamil" ? "ta" : "en"}>
                {cur.body.replace("{{1}}", first).replace("{{2}}", lead.firm)}
              </div>
              {err && <p role="alert" className="text-[12px] text-danger">{err}</p>}
              <Foot onCancel={close} label="Send (simulated)" pending={pending} />
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "email"} onOpenChange={(o) => !o && close()}>
        <DialogContent title="Email" description={`Opens your mail app to ${lead.email} and logs the email on this timeline.`}>
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget); const subject = String(f.get("subject")), body = String(f.get("body"));
            run(() => logEmail(lead.id, subject), () => { window.location.href = `mailto:${lead.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`; });
          }}>
            <Lbl t="Subject"><input name="subject" required className={field} defaultValue={la.emailSubject(tenantName, lead.firm)} /></Lbl>
            <Lbl t="Message"><textarea name="body" className={cn(field, "h-28 py-2")} defaultValue={la.emailBody(first, tenantName)} /></Lbl>
            {err && <p role="alert" className="text-[12px] text-danger">{err}</p>}
            <Foot onCancel={close} label="Log and open mail app" pending={pending} />
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "demo"} onOpenChange={(o) => !o && close()}>
        <DialogContent title={la.demoTitle} description={la.demoDesc(lead.firm)}>
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            run(() => scheduleDemo(lead.id, { date: String(f.get("date")), time: String(f.get("time")), minutes: Number(f.get("minutes")), mode: String(f.get("mode")) }));
          }}>
            <div className="grid grid-cols-2 gap-3">
              <Lbl t="Date"><input name="date" className={field} type="date" defaultValue={lead.tomorrow} min={lead.today} required /></Lbl>
              <Lbl t="Time (IST)"><input name="time" className={field} type="time" defaultValue="17:30" min="08:00" max="20:00" required /></Lbl>
              <Lbl t="Duration"><select name="minutes" className={field} defaultValue="30"><option value="30">30 min</option><option value="45">45 min</option></select></Lbl>
              <Lbl t="Mode"><select name="mode" className={field}>{la.modes.map((m) => <option key={m}>{m}</option>)}</select></Lbl>
            </div>
            <p className="text-[12px] text-ink-3">{la.demoNote}</p>
            {err && <p role="alert" className="text-[12px] text-danger">{err}</p>}
            <Foot onCancel={close} label={la.demoFoot} pending={pending} />
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "dq"} onOpenChange={(o) => !o && close()}>
        <DialogContent title={`Disqualify ${lead.name}?`} description={la.dqDesc}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); run(() => changeStatus(lead.id, "disqualified", String(f.get("reason")))); }}>
            <Lbl t="Reason"><select name="reason" className={field} required defaultValue=""><option value="" disabled>Choose a reason</option>{DQ.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Lbl>
            {err && <p role="alert" className="text-[12px] text-danger">{err}</p>}
            <Foot onCancel={close} label="Disqualify" pending={pending} />
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
