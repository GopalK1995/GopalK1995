"use client";
// Pending feedback for server-action forms. useFormStatus reads the nearest parent <form>, so these must be rendered
// inside it. While the action runs the button disables (no double post), sets aria-busy and shows a spinner / label.
import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./button";

export interface SubmitButtonProps extends Omit<ButtonProps, "type" | "loading" | "loadingLabel"> {
  /** Label while the action runs, e.g. "Signing in…". */
  pendingLabel?: ReactNode;
}

export function SubmitButton({ pendingLabel, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return <Button {...props} type="submit" loading={pending} loadingLabel={pendingLabel} />;
}

/** Unstyled twin for custom-styled submit buttons (persona cards, link-like buttons): same pending contract, caller supplies the classes. */
export function PendingButton({ children, disabled, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  const { pending } = useFormStatus();
  return (
    <button {...props} type="submit" disabled={disabled || pending} aria-busy={pending || undefined} data-pending={pending || undefined}>
      {children}
    </button>
  );
}
