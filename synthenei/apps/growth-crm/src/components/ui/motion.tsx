"use client";
// Motion rules: ease-out, <= 280 ms, no bounce, no loops. Everything collapses to instant under reduced motion.
import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export const EASE = [0.22, 1, 0.36, 1] as const;

// Entrance stagger is pure CSS (globals.css .stagger): server and client render identical markup, content is
// visible with JS off, and prefers-reduced-motion disables it in CSS. No hydration-dependent opacity.
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("stagger", className)}>{children}</div>;
}
export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("min-w-0", className)}>{children}</div>;
}
/** Card hover lift (2px, 160 ms). */
export function Lift({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} whileHover={{ y: -2 }} transition={{ duration: 0.16, ease: EASE }}>
      {children}
    </motion.div>
  );
}

/** Counts up from 0 when first in view. SSR renders the final text, so no-JS and screenshots show real values. */
export function CountUp({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!inView || reduce || !ref.current || !Number.isFinite(value)) return;
    const el = ref.current;
    const c = animate(0, value, { duration: 0.28, ease: EASE, onUpdate: (v) => { el.textContent = format(v); } });
    return () => c.stop();
  }, [inView, reduce, value, format]);
  return <span ref={ref} className={cn("num", className)}>{format(value)}</span>;
}
