"use client";
import { useState, useTransition, type ReactElement } from "react";
import { cloneElement } from "react";
import { Lock, Plug, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Tip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/components/shell/providers";
import { ROLE_LABEL, can } from "@/lib/auth/roles";
import { connectIntegration, runSyncNow } from "./actions";

/** Disabled control with the reason in a tooltip (keyboard-focusable wrapper). */
export function Blocked({ reason, children }: { reason: string; children: ReactElement<{ disabled?: boolean }> }) {
  return <Tip content={reason}><span tabIndex={0} className="inline-flex rounded-sm">{cloneElement(children, { disabled: true })}</span></Tip>;
}
const SUPPORT_REASON = "Not available in a support session.";

export function CsvImportButton() {
  return (
    <Button onClick={() => toast("CSV import would open here", "Demo: upload a platform export, map columns, review rejects. Nothing was saved.")}>
      <Upload />Import CSV
    </Button>
  );
}

export function ConnectButton({ id, name, blockers }: { id: string; name: string; blockers: string[] }) {
  const { role, support } = useSession();
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const [check, setCheck] = useState<string | null>(null);
  const btn = <Button variant="primary"><Plug />Connect</Button>;
  if (support) return <Blocked reason={SUPPORT_REASON}>{btn}</Blocked>;
  if (!can("connectIntegrations", { role, support })) return <Blocked reason={`Only the Owner can connect integrations. Your role: ${ROLE_LABEL[role]}.`}>{btn}</Blocked>;
  return (
    <Dialog open={open} onOpenChange={(o) => {
      setOpen(o);
      // Server re-checks role + support session; the dialog only explains, it never stores credentials.
      if (o) start(async () => { const r = await connectIntegration(id); setCheck(r.ok ? null : r.message); });
    }}>
      <DialogTrigger asChild>{btn}</DialogTrigger>
      <DialogContent title={`Connect ${name}`} description="This connector is a showcase in this deployment.">
        <div className="space-y-3 text-[13px] leading-5 text-ink-2">
          {check && <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-danger">{check}</p>}
          <p>The steps, field mapping and sync log on this page run on sample data. No credentials are stored and nothing is sent to {name}.</p>
          {blockers.length > 0 && (
            <div className="rounded-sm border border-line bg-paper px-3 py-2.5">
              <div className="eyebrow mb-1">Needed before it can go live</div>
              <ul className="list-disc space-y-0.5 pl-4">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            </div>
          )}
          <p>Going live also needs a secret in the server vault (never in the database) and a mapping review by the Data role.</p>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <DialogClose asChild><Button>Close</Button></DialogClose>
          <Tip content={`Not enabled in this deployment. Needs: ${blockers.slice(0, 2).join(", ") || "account access"}.`}>
            <span tabIndex={0} className="inline-flex"><Button variant="primary" disabled><Lock />Authorise</Button></span>
          </Tip>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RunSyncButton({ id }: { id: string }) {
  const { role, support } = useSession();
  const [pending, start] = useTransition();
  const btn = <Button disabled={pending} onClick={() => start(async () => { const r = await runSyncNow(id); toast(r.message, r.detail); })}><RefreshCw />Run sync now</Button>;
  if (support?.mode === "read_only") return <Blocked reason="Read-only support session.">{btn}</Blocked>;
  if (!(role === "owner" || role === "data")) return <Blocked reason={`Owner or Data only. Your role: ${ROLE_LABEL[role]}.`}>{btn}</Blocked>;
  return btn;
}
