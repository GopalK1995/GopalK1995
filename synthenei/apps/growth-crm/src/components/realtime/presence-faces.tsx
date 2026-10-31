"use client";
// "Who is here" faces for a record page or board. The channel is joined only when `canRead` is true (the server page computed it
// with assertCan read), so a viewer's presence never reveals records they cannot open. A face joining animates (a change the user
// must notice); everything is instant under reduced motion. Sample colleagues (demo) are dashed and labelled.
import { AnimatePresence, motion } from "motion/react";
import { useSafeMotion } from "@/components/ui/motion";
import { usePresence } from "@/lib/realtime/hooks";
import type { PresenceUser } from "@/lib/realtime/types";
import { EN, fill, type RealtimeStrings } from "./strings";

export function PresenceFacesView({ users, max = 4, labels = EN }: { users: readonly PresenceUser[]; max?: number; labels?: RealtimeStrings }) {
  const { instant, transition } = useSafeMotion();
  const shown = users.slice(0, max), extra = users.length - shown.length;
  const names = users.map((u) => (u.sample ? `${u.name} (${labels.sampleTag})` : u.name)).join(", ");
  const text = users.length === 0 ? labels.hereNone : users.length === 1 ? fill(labels.hereOne, { name: names }) : fill(labels.hereMany, { n: users.length, names });
  return (
    <span className="inline-flex items-center" role="group" aria-label={text} title={text} data-testid="presence-faces" data-count={users.length}>
      <AnimatePresence initial={false}>
        {shown.map((u, i) => (
          <motion.span key={u.userId} data-testid="presence-face" data-sample={u.sample ? "true" : undefined}
            initial={instant ? false : { opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={instant ? undefined : { opacity: 0, scale: 0.8 }} transition={transition("fast")}
            className="inline-grid size-6 shrink-0 place-items-center rounded-full border border-paper text-12 font-semibold text-ink"
            style={{ marginLeft: i === 0 ? 0 : -6, background: `color-mix(in oklch, var(--${u.color}) 18%, var(--paper))`, borderStyle: u.sample ? "dashed" : "solid", borderColor: u.sample ? `var(--${u.color})` : undefined }}>
            <span aria-hidden>{u.initials}</span>
          </motion.span>
        ))}
      </AnimatePresence>
      {extra > 0 && <span className="num ml-1 text-12 text-ink-2">+{extra}</span>}
    </span>
  );
}

/** topic: from recordTopic()/boardTopic(). canRead: the server's assertCan read result for this record or board. */
export function PresenceFaces({ topic, canRead, max, labels }: { topic: string; canRead: boolean; max?: number; labels?: RealtimeStrings }) {
  const users = usePresence(topic, { authorize: canRead });
  if (!canRead || users.length === 0) return null;
  return <PresenceFacesView users={users} max={max} labels={labels} />;
}
