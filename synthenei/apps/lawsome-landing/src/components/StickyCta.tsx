"use client";
import { useEffect, useState } from "react";
import { CtaLink } from "./CtaLink";

// Floating CTA: appears once the hero is scrolled past, steps aside when the lead form is on screen.
export function StickyCta() {
  const [past, setPast] = useState(false);
  const [atForm, setAtForm] = useState(false);
  useEffect(() => {
    const onScroll = () => setPast(window.scrollY > window.innerHeight * 0.9);
    onScroll(); window.addEventListener("scroll", onScroll, { passive: true });
    const el = document.getElementById("demo");
    const io = el ? new IntersectionObserver(([e]) => setAtForm(e.isIntersecting), { threshold: 0.15 }) : null;
    if (el && io) io.observe(el);
    return () => { window.removeEventListener("scroll", onScroll); io?.disconnect(); };
  }, []);
  if (!past || atForm) return null;
  return <div className="sticky-cta"><CtaLink where="sticky">Book a Live Demo</CtaLink></div>;
}
