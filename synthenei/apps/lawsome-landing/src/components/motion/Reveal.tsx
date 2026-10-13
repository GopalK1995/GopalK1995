"use client";
import { useReduced } from "@/components/motion/useReduced";
import { motion, type Variants } from "motion/react";
import type { ReactNode } from "react";
import { DUR, EASE } from "./ease";

const item: Variants = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: DUR.slow, ease: EASE } } };
const group: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };

/** Fades/rises its children in once when scrolled into view. Children wrapped in <RevealItem> stagger. */
export function Reveal({ children, className, as = "div" }: { children: ReactNode; className?: string; as?: "div" | "ul" }) {
  const reduce = useReduced();
  const M = as === "ul" ? motion.ul : motion.div;
  if (reduce) { const T = as; return <T className={className}>{children}</T>; }
  return <M className={className} variants={group} initial="hidden" whileInView="show" viewport={{ once: true, margin: "0px 0px -12% 0px" }}>{children}</M>;
}

export function RevealItem({ children, className, as = "div" }: { children: ReactNode; className?: string; as?: "div" | "li" }) {
  const reduce = useReduced();
  const M = as === "li" ? motion.li : motion.div;
  if (reduce) { const T = as; return <T className={className}>{children}</T>; }
  return <M className={className} variants={item}>{children}</M>;
}

/** Pillar card: reveals with the group, lifts 4px on hover. */
export function LiftCard({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReduced();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} variants={item} whileHover={{ y: -4, transition: { duration: DUR.fast, ease: EASE } }}>
      {children}
    </motion.div>
  );
}
