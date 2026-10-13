"use client";
import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

/** prefers-reduced-motion, but false until hydrated so server and client markup always match. */
export function useReduced() {
  const r = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && !!r;
}
