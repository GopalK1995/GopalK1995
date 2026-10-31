"use client";
// Manual entry of one day of metrics for a campaign (upserts that day).
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { saveMetricsDay } from "../_actions";
import { MktGate, notify } from "./action";

const field = "h-9 w-full rounded-sm border border-line-strong bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-ring num";
const FIELDS = [["spend", "Spend (₹)"], ["impressions", "Impressions"], ["reach", "Reach"], ["clicks", "Clicks"], ["platformLeads", "Platform leads"]] as const;

export function MetricsDayDialog({ campaignId }: { campaignId: string }) {
  const [day, setDay] = useState("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const submit = () => start(async () => {
    const row: Record<string, unknown> = { day };
    for (const [k] of FIELDS) row[k] = vals[k] ? Number(vals[k]) : 0;
    notify(await saveMetricsDay(campaignId, row));
  });
  return (
    <Dialog>
      <MktGate can="editCampaigns"><DialogTrigger asChild><Button><Plus />Add a day</Button></DialogTrigger></MktGate>
      <DialogContent title="Add daily metrics" description="Saving a day that already exists replaces it.">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div><label className="mb-1 block text-[12px] font-medium text-ink-2" htmlFor="md-day">Date</label><input id="md-day" type="date" className={field} value={day} onChange={(e) => setDay(e.target.value)} required /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map(([k, l]) => (
              <div key={k}><label className="mb-1 block text-[12px] font-medium text-ink-2" htmlFor={`md-${k}`}>{l}</label>
                <input id={`md-${k}`} inputMode="decimal" className={field + " text-right"} value={vals[k] ?? ""} onChange={(e) => setVals((x) => ({ ...x, [k]: e.target.value.replace(/[^\d.]/g, "") }))} placeholder="0" /></div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" variant="primary" disabled={pending || !day}>Save day</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
