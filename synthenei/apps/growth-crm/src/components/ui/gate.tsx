"use client";
import type { ReactElement } from "react";
import { cloneElement } from "react";
import { Tip } from "./tooltip";
import { useSession } from "@/components/shell/providers";
import { ROLE_LABEL, can as canDo, type Action } from "@/lib/auth/roles";

/** Disables an action the current role may not perform and explains why in a tooltip. */
export function Gate({ can, children, reason }: { can: Action; children: ReactElement<{ disabled?: boolean }>; reason?: string }) {
  const { role, support } = useSession();
  if (canDo(can, { role, support })) return children;
  const why = support ? `Disabled during a support session (${support.mode === "read_only" ? "read-only" : "read-write; exports, branding, integrations and erasure stay off"}).` : null;
  return (
    <Tip content={why ?? reason ?? `Your role (${ROLE_LABEL[role]}) cannot do this.`}>
      <span tabIndex={0} className="inline-flex">{cloneElement(children, { disabled: true })}</span>
    </Tip>
  );
}
