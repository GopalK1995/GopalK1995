"use client";
import { useReduced } from "@/components/motion/useReduced";
import { animate, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { EASE } from "./ease";

/**
 * Renders the final number on the server (no-JS, screenshots and video stay correct).
 * If the number is below the fold at load, it resets to 0 and counts up once it comes into view.
 */
export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReduced();
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const [n, setN] = useState(value);
  const armed = useRef(false);
  useEffect(() => {
    const el = ref.current; if (!el || reduce || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    if (r.top > window.innerHeight) { armed.current = true; setN(0); }
  }, [reduce]);
  useEffect(() => {
    if (!inView || !armed.current) return;
    armed.current = false;
    const c = animate(0, value, { duration: 0.8, ease: EASE, onUpdate: (v) => setN(Math.round(v)) });
    return () => c.stop();
  }, [inView, value]);
  return <span ref={ref} style={{ fontVariantNumeric: "tabular-nums" }}>{n}</span>;
}
