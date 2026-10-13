"use client";
// Gated action buttons for marketing pages. The server action re-checks the permission; this only hides intent
// the role cannot act on (disabled + reason tooltip, spec 10.3 / 10.5) and toasts what the demo would do.
import { cloneElement, useTransition, type ReactElement, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/components/shell/providers";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { canMkt, type MktAction } from "../_lib/perm";
import type { ActionResult } from "../_actions";

export function useMktCan(action: MktAction) {
  const { role, support } = useSession();
  return canMkt(action, { role, support });
}

/** Like the shared Gate, plus "editSegments". Reason names the role, or the support session. */
export function MktGate({ can, children }: { can: MktAction; children: ReactElement<{ disabled?: boolean }> }) {
  const { role, support } = useSession();
  if (canMkt(can, { role, support })) return children;
  const why = support ? "Not available in a support session." : `Your role (${ROLE_LABEL[role]}) cannot do this.`;
  return (
    <Tip content={why}>
      <span tabIndex={0} className="inline-flex">{cloneElement(children, { disabled: true })}</span>
    </Tip>
  );
}

export function notify(r: ActionResult) {
  toast(r.message, r.detail);
}

/** Button that runs a (bound) server action and toasts the result. */
export function ActionButton({ action, can, children, ...p }: { action: () => Promise<ActionResult>; can: MktAction; children: ReactNode } & Omit<ButtonProps, "onClick" | "action">) {
  const [pending, start] = useTransition();
  return (
    <MktGate can={can}>
      <Button {...p} disabled={pending || p.disabled} aria-busy={pending} onClick={() => start(async () => notify(await action()))}>{children}</Button>
    </MktGate>
  );
}
