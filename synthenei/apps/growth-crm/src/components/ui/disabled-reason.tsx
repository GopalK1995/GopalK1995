"use client";
import { cloneElement, useId, type ReactElement } from "react";
import { Tip } from "./tooltip";

/**
 * Wraps a control that is disabled for a stated reason ("Needs the leads.export permission").
 * The control stays focusable (aria-disabled, not `disabled`) so keyboard users reach the tooltip,
 * and the reason is also exposed through aria-describedby. Pass `reason` falsy to leave the control untouched.
 */
export function DisabledReason({ reason, children }: { reason?: string | null; children: ReactElement<Record<string, unknown>> }) {
  const id = useId();
  if (!reason) return children;
  const child = cloneElement(children, {
    "aria-disabled": true,
    "aria-describedby": id,
    "data-disabled-reason": "true",
    onClick: (e: { preventDefault: () => void; stopPropagation: () => void }) => { e.preventDefault(); e.stopPropagation(); },
    onKeyDown: (e: { key: string; preventDefault: () => void }) => { if (e.key === "Enter" || e.key === " ") e.preventDefault(); },
  });
  return (
    <>
      <Tip content={reason}>{child}</Tip>
      <span id={id} className="sr-only">{reason}</span>
    </>
  );
}
