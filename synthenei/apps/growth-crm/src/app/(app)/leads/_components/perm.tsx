"use client";
// Permission state for menus that cannot be wrapped in the shared Gate (Radix menu roots):
// "no" = role lacks the action (hide), "support" = blocked only by a support session (show disabled), "yes".
import { useSession } from "@/components/shell/providers";
import { CAN, can, type Action } from "@/lib/auth/roles";

export function usePerm(action: Action): "yes" | "support" | "no" {
  const { role, support } = useSession();
  if (!CAN[action](role)) return "no";
  return can(action, { role, support }) ? "yes" : "support";
}
