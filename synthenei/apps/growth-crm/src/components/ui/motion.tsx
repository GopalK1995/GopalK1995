"use client";
// Motion rules (plan 3.3): 150-200 ms, ease-out, only for changes the user caused or must notice
// (drawer/dialog open, a card moving between stages, a presence face joining, a toast, a row settling).
// No entrance animations on page load, no cascades, no count-ups. Everything is an instant swap under reduced motion.
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const EASE = [0.2, 0, 0, 1] as const;
export const DURATION = { fast: 0.15, base: 0.2 } as const;

/** Reduced-motion aware transition helper. `instant` is true when the user prefers reduced motion. */
export function useSafeMotion() {
  const instant = !!useReducedMotion();
  return {
    instant,
    /** Transition for a user-caused change; zero duration when reduced motion is on. */
    transition: (d: keyof typeof DURATION = "base") => ({ duration: instant ? 0 : DURATION[d], ease: EASE }),
  };
}

/** Preset for something appearing because of a user action: 200 ms fade plus 4 px slide. */
export const fadeSlide = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
  transition: { duration: DURATION.base, ease: EASE },
} as const;

/** Wrap content that appears after a user action. Renders without animation under reduced motion. */
export function FadeSlide({ children, className }: { children: ReactNode; className?: string }) {
  const { instant } = useSafeMotion();
  if (instant) return <div className={className}>{children}</div>;
  return <motion.div className={className} {...fadeSlide}>{children}</motion.div>;
}

// Legacy exports, kept so existing imports keep working. They no longer animate on load.
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("stagger", className)}>{children}</div>;
}
export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("min-w-0", className)}>{children}</div>;
}
/** Hover lift, user-caused, 150 ms, skipped under reduced motion. */
export function Lift({ children, className }: { children: ReactNode; className?: string }) {
  const { instant, transition } = useSafeMotion();
  return (
    <motion.div className={className} whileHover={instant ? undefined : { y: -2 }} transition={transition("fast")}>
      {children}
    </motion.div>
  );
}
/** Was a count-up animation; plan 3.2 bans those, so it now renders the final value directly. */
export function CountUp({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  return <span className={cn("num", className)}>{format(value)}</span>;
}
