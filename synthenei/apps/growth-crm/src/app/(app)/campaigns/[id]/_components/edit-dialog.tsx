"use client";
// Edit a campaign. The UTM and channel are fixed so attribution holds. A version conflict says so and offers a reload.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { editCampaign } from "../../_actions";
import { MktGate, notify } from "../../_components/action";

const field = "h-9 w-full rounded-sm border border-line-strong bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-ring";
const lbl = "mb-1 block text-[12px] font-medium text-ink-2";
type C = { id: string; name: string; objective: string; budget: number; startDate: string; endDate: string | null; version?: number };

export function EditCampaignDialog({ c }: { c: C }) {
  const router = useRouter();
  const [name, setName] = useState(c.name), [objective, setObjective] = useState(c.objective), [budget, setBudget] = useState(String(c.budget || ""));
  const [starts, setStarts] = useState(c.startDate), [ends, setEnds] = useState(c.endDate ?? "");
  const [conflict, setConflict] = useState(false);
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    const r = await editCampaign(c.id, { name, objective: objective || null, budget: Number(budget), startsOn: starts || null, endsOn: ends || null }, c.version);
    notify(r);
    setConflict(!r.ok && r.code === "conflict");
    if (r.ok) router.refresh();
  });
  return (
    <Dialog>
      <MktGate can="editCampaigns"><DialogTrigger asChild><Button variant="primary"><Pencil />Edit</Button></DialogTrigger></MktGate>
      <DialogContent title="Edit campaign" description="Name, dates, budget and objective can change. The UTM stays fixed so attribution holds.">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div><label className={lbl} htmlFor="ec-name">Name</label><input id="ec-name" className={field} value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div><label className={lbl} htmlFor="ec-obj">Objective</label><input id="ec-obj" className={field} value={objective} onChange={(e) => setObjective(e.target.value)} /></div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className={lbl} htmlFor="ec-b">Budget (₹)</label><input id="ec-b" inputMode="numeric" className={field + " num text-right"} value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))} required /></div>
            <div><label className={lbl} htmlFor="ec-s">Starts</label><input id="ec-s" type="date" className={field} value={starts} onChange={(e) => setStarts(e.target.value)} /></div>
            <div><label className={lbl} htmlFor="ec-e">Ends</label><input id="ec-e" type="date" className={field} value={ends} onChange={(e) => setEnds(e.target.value)} /></div>
          </div>
          {conflict && (
            <p role="alert" className="flex items-center justify-between gap-2 rounded-sm border border-warn px-3 py-2 text-[12px] text-warn-ink">
              Someone else changed this campaign. Reload to see their version, then apply your change again.
              <Button type="button" size="sm" variant="secondary" onClick={() => router.refresh()}>Reload</Button>
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" variant="primary" disabled={pending}>Save changes</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
