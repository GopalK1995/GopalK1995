"use client";
import { Bell, BellOff } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { setFollow } from "./actions";
import type { Strings } from "./strings";

export function FollowButton({ objectType, objectId, initial, canFollow, s }: {
  objectType: string; objectId: string; initial: boolean; canFollow: boolean; s: Strings;
}) {
  const [following, setFollowing] = useState(initial);
  const [busy, start] = useTransition();
  return (
    <Button
      variant="quiet" size="sm" aria-pressed={following} disabled={busy}
      disabledReason={canFollow ? undefined : s.composerDisabledNoPerm}
      title={s.followersNote}
      onClick={() => start(async () => {
        const next = !following;
        setFollowing(next); // optimistic
        const r = await setFollow({ objectType, objectId, follow: next });
        if (!r.ok) { setFollowing(!next); toast(r.message, ""); return; }
        setFollowing(r.data?.following ?? next);
        toast(r.message, r.sub ?? "");
      })}
    >
      {following ? <BellOff className="size-3" strokeWidth={1.75} aria-hidden /> : <Bell className="size-3" strokeWidth={1.75} aria-hidden />}
      {following ? s.unfollow : s.follow}
    </Button>
  );
}
