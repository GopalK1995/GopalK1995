"use client";
import { cloneElement, type ReactElement } from "react";
import { Tip } from "@/components/ui/tooltip";
import type { Verdict } from "./perms";

/** Disabled-with-reason wrapper for actions decided on the server (role, ownership, support session). */
export function Gated({ v, children }: { v: Verdict; children: ReactElement<{ disabled?: boolean }> }) {
  if (v.ok) return children;
  return (
    <Tip content={v.reason}>
      <span tabIndex={0} className="inline-flex rounded-sm focus-visible:outline-2 focus-visible:outline-ring">{cloneElement(children, { disabled: true })}</span>
    </Tip>
  );
}
