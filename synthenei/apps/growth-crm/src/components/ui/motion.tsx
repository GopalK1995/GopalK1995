"use client";
// Motion rules: ease-out, <= 280 ms, no bounce, no loops. Everything collapses to instant under reduced motion.
import { animate, motion, useInView, useReducedMotion, type Variants } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export const EASE = [0.22, 1, 0.36, 1] as const;
const container: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.035, delayChildren: 0.02 } } };
const item: Variants = { hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE } } };

// Never branch markup on useReducedMotion() (null on the server -> hydration mismatch). MotionConfig
// reducedMotion="user" in Providers drops transforms; durations below shrink to 0 on the client.
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return <motion.div className={className} variants={container} initial="hidden" animate="show">{children}</motion.div>;
}
export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return <motion.div className={cn("min-w-0", className)} variants={item}>{children}</motion.div>;
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
