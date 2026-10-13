"use client";
import { useEffect, useState } from "react";
import { CtaLink } from "./CtaLink";

// Floating CTA that steps aside once the lead form is on screen.
export function StickyCta() {
  const [hide, setHide] = useState(false);
  useEffect(() => {
    const el = document.getElementById("demo"); if (!el) return;
    const io = new IntersectionObserver(([e]) => setHide(e.isIntersecting), { threshold: 0.15 });
    io.observe(el); return () => io.disconnect();
  }, []);
  if (hide) return null;
  return <div className="sticky-cta"><CtaLink where="sticky">Book a Live Demo</CtaLink></div>;
}
