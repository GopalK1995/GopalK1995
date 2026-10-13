"use client";
import { useReduced } from "@/components/motion/useReduced";
import { motion, useScroll, useTransform } from "motion/react";
import { useRef, type ReactNode } from "react";

/** Product screen that slides in tilted back and settles flat as it reaches the middle of the viewport. */
export function TiltFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReduced();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start 0.35"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [10, 0]);
  const y = useTransform(scrollYProgress, [0, 1], [48, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.96, 1]);
  return (
    <div ref={ref} className={`tilt ${className}`}>
      <motion.div style={reduce ? undefined : { rotateX, y, scale, transformOrigin: "50% 0%" }}>{children}</motion.div>
    </div>
  );
}
