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

/** Showcase: Authorise is always disabled (spec 7.3). "How to connect" explains the steps; Owner only, never in a support session. */
export function ConnectButton({ id, name, blockers }: { id: string; name: string; blockers: string[] }) {
  const { role, support } = useSession();
  const [, start] = useTransition();
  const [check, setCheck] = useState<string | null>(null);
  const needs = blockers.slice(0, 2).join(", ") || "account access";
  const authorise = <Tip content={`Not enabled in this deployment. Needs: ${needs}.`}><span tabIndex={0} className="inline-flex rounded-sm"><Button variant="primary" disabled><Lock />Authorise</Button></span></Tip>;
  const how = <Button><Plug />How to connect</Button>;
  const gate = support ? SUPPORT_REASON : !can("connectIntegrations", { role, support }) ? `Only the Owner can connect integrations. Your role: ${ROLE_LABEL[role]}.` : null;
  return (
    <>
      {gate ? <Blocked reason={gate}>{how}</Blocked> : (
        <Dialog onOpenChange={(o) => {
          // Server re-checks role + support session; the dialog only explains, it never stores credentials.
          if (o) start(async () => { const r = await connectIntegration(id); setCheck(r.ok ? null : r.message); });
        }}>
          <DialogTrigger asChild>{how}</DialogTrigger>
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
            <div className="mt-5 flex justify-end"><DialogClose asChild><Button>Close</Button></DialogClose></div>
          </DialogContent>
        </Dialog>
      )}
      {authorise}
    </>
  );
}

export function RunSyncButton({ id, csv }: { id: string; csv?: boolean }) {
  const { role, support } = useSession();
  const [pending, start] = useTransition();
  const btn = <Button disabled={pending} onClick={() => start(async () => { const r = await runSyncNow(id); toast(r.message, r.detail); })}><RefreshCw />{csv ? "Import CSV now" : "Run sync now"}</Button>;
  if (!csv) return <Blocked reason="Showcase: nothing to sync until it is connected. CSV import is the live path.">{btn}</Blocked>;
  if (support?.mode === "read_only") return <Blocked reason="Read-only support session.">{btn}</Blocked>;
  if (!(role === "owner" || role === "data")) return <Blocked reason={`Owner or Data only. Your role: ${ROLE_LABEL[role]}.`}>{btn}</Blocked>;
  return btn;
}
