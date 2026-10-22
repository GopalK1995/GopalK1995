"use client";
import { useState, useTransition } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Tip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { useSession, useVocab } from "@/components/shell/providers";
import { ROLE_LABEL, can } from "@/lib/auth/roles";
import { completeErasure } from "./actions";

/** Owner-only, never in a support session. Confirm dialog names the object (spec 5). */
export function EraseButton({ requestId, subject }: { requestId: string; subject: string }) {
  const { role, support } = useSession();
  const st = useVocab().st;
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const allowed = can("erase", { role, support }) && can("privacyRequests", { role, support });
  const btn = <Button size="sm" variant="danger"><Eraser />Complete erasure</Button>;
  if (!allowed) {
    const why = support ? "Not available in a support session." : `Only the Owner can erase. Your role: ${ROLE_LABEL[role]}.`;
    return <Tip content={why}><span tabIndex={0} className="inline-flex">{<Button size="sm" variant="danger" disabled><Eraser />Complete erasure</Button>}</span></Tip>;
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{btn}</DialogTrigger>
      <DialogContent title={`Erase ${subject}?`} description={st.erase(requestId)}>
        <div className="flex justify-end gap-2">
          <DialogClose asChild><Button>Cancel</Button></DialogClose>
          <Button variant="danger" disabled={pending} onClick={() => start(async () => { const r = await completeErasure(requestId); setOpen(false); toast(r.message, r.detail); })}>Erase {subject}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
