"use client";
import { useVocab } from "@/components/shell/providers";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

const field = "h-9 w-full rounded-sm border border-line-strong bg-surface px-2.5 text-[13px] outline-none focus:border-ring";
export function Prefs({ name, email }: { name: string; email: string }) {
  const nt = useVocab().st.notify;
  const [notify, setNotify] = useState({ sla: true, demo: true, digest: false });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); toast("Profile saved", "Demo: preferences are not stored."); }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Full name</span><input className={field} defaultValue={name} /></label>
        <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Email</span><input className={field + " bg-paper-2 text-ink-3"} defaultValue={email} readOnly /></label>
        <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Mobile (for WhatsApp alerts)</span><input className={field} defaultValue="+91 98xxx xx214" /></label>
        <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Language</span><select className={field} defaultValue="en"><option value="en">English</option><option value="ta">தமிழ் (Tamil)</option></select></label>
      </div>
      <fieldset className="rounded-md border border-line p-3">
        <legend className="px-1 text-[12px] font-medium text-ink-2">Notify me</legend>
        {([["sla", nt.sla], ["demo", nt.demo], ["digest", nt.digest]] as const).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2.5 py-1.5 text-[13px] text-ink">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={notify[k]} onChange={(e) => setNotify((n) => ({ ...n, [k]: e.target.checked }))} />{label}
          </label>
        ))}
      </fieldset>
      <div className="flex justify-end"><Button variant="primary">Save profile</Button></div>
    </form>
  );
}
