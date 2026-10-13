"use client";
import { Ellipsis, KeyRound, Mail, ShieldOff, UserX } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSep, MenuTrigger } from "@/components/ui/dropdown";
import { toast } from "@/components/ui/toast";
import { userAction } from "./actions";

/** Per-user platform actions. Role changes are done by the workspace Owner, so they are not offered here. */
export function UserRowMenu({ userId, name, invited, memberships }: { userId: string; name: string; invited: boolean; memberships: number }) {
  const run = async (kind: string) => {
    const fd = new FormData(); fd.set("user", userId); fd.set("kind", kind);
    const r = await userAction(fd); toast(r.message, r.sub);
  };
  return (
    <Menu>
      <MenuTrigger className="rounded-sm p-1.5 text-ink-3 outline-none hover:bg-paper-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Actions for ${name}`}><Ellipsis className="size-4" /></MenuTrigger>
      <MenuContent className="w-64">
        <MenuLabel>{name}</MenuLabel>
        {invited && <MenuItem onSelect={() => void run("resend_invite")}><Mail />Resend invitation</MenuItem>}
        <MenuItem onSelect={() => void run("revoke_sessions")}><KeyRound />Revoke sessions</MenuItem>
        <MenuItem onSelect={() => void run("deactivate")} className="text-danger"><UserX />Deactivate platform-wide</MenuItem>
        <MenuSep />
        <MenuItem disabled><ShieldOff />Make platform admin</MenuItem>
        <p className="px-2 pb-1.5 text-[11px] leading-4 text-ink-3">Not allowed: {memberships} workspace membership{memberships === 1 ? "" : "s"}. Platform admins are separate identities.</p>
      </MenuContent>
    </Menu>
  );
}
