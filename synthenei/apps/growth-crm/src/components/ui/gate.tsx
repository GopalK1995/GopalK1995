"use client";
import type { ReactElement } from "react";
import { cloneElement } from "react";
import { Tip } from "./tooltip";
import { useSession } from "@/components/shell/providers";
import { ROLE_LABEL, can as canDo, type Action } from "@/lib/auth/roles";

/** Disables an action the current role may not perform and explains why in a tooltip. */
/** Role lacks the action -> hidden (spec 10.3), unless `showDisabled` (then disabled + reason).
 *  Role allows it but a support session blocks it -> visible, disabled, "Not available in a support session". */
export function Gate({ can, children, reason, showDisabled = false }: { can: Action; children: ReactElement<{ disabled?: boolean }>; reason?: string; showDisabled?: boolean }) {
  const { role, support } = useSession();
  if (canDo(can, { role, support })) return children;
  const roleOk = canDo(can, { role, support: null });
  if (!roleOk && !showDisabled) return null;
  const why = roleOk && support ? "Not available in a support session" : null;
  return (
    <Tip content={why ?? reason ?? `Your role (${ROLE_LABEL[role]}) cannot do this.`}>
      <span tabIndex={0} className="inline-flex">{cloneElement(children, { disabled: true })}</span>
    </Tip>
  );
}
