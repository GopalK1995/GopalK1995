"use client";
import { useReduced } from "@/components/motion/useReduced";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useMotionValue, useScroll, useSpring, useTransform } from "motion/react";
import { MapFallback } from "./MapFallback";
import { DISTRICTS } from "./tnMap";

// three.js + R3F live in their own chunk, requested only when the device qualifies.
const HeroScene = dynamic(() => import("./HeroScene"), { ssr: false });

function canUse3D() {
  try {
    if (window.innerWidth < 640) return false;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    if (nav.connection?.saveData) return false;
    if ((nav.deviceMemory ?? 8) < 4 || (nav.hardwareConcurrency ?? 8) < 4) return false;
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

const MAP_LABEL = "Line map of Tamil Nadu with six district offices (Chennai, Salem, Coimbatore, Trichy, Madurai, Tirunelveli). Links between them light in sequence, like hearings moving across a firm's offices. Illustrative.";

export function HeroStage({ copy, screen }: { copy: ReactNode; screen: ReactNode }) {
  const reduce = useReduced();
  const mapRef = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const [use3D, setUse3D] = useState(false);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);
  const [resting, setResting] = useState(false);

  // pointer, normalised to -1..1 and smoothed (no overshoot)
  const rawX = useMotionValue(0), rawY = useMotionValue(0);
  const px = useSpring(rawX, { stiffness: 50, damping: 20, mass: 1 });
  const py = useSpring(rawY, { stiffness: 50, damping: 20, mass: 1 });
  // the map flattens a little as the page scrolls
  const { scrollY } = useScroll();
  const settle = useTransform(scrollY, [0, 520], [0, 1], { clamp: true });
  // product screen: small tilt (6deg) that is flat by the time it reaches the fold; no pointer parallax
  const rotateX = useTransform(scrollY, [0, 360], [6, 0], { clamp: true });
  const scale = useTransform(scrollY, [0, 360], [0.98, 1], { clamp: true });
  const [replay, setReplay] = useState(0);
  const lastPlay = useRef(0);

  useEffect(() => {
    if (reduce) return;
    const fine = window.matchMedia("(pointer: fine)").matches;
    const move = (e: PointerEvent) => { rawX.set((e.clientX / window.innerWidth) * 2 - 1); rawY.set((e.clientY / window.innerHeight) * 2 - 1); };
    if (fine) window.addEventListener("pointermove", move, { passive: true });
    // load the 3D chunk after first paint, when the browser is idle
    let idle = 0;
    const start = () => {
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      const go = () => { if (canUse3D()) { lastPlay.current = Date.now(); setUse3D(true); } };
      idle = ric ? ric(go, { timeout: 1200 }) : window.setTimeout(go, 300);
    };
    if (document.readyState === "complete") start(); else window.addEventListener("load", start, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("load", start); window.clearTimeout(idle); };
  }, [reduce, rawX, rawY]);

  useEffect(() => { // pause rendering when the map is off-screen
    const el = mapRef.current; if (!el || !use3D) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "80px" });
    io.observe(el); return () => io.disconnect();
  }, [use3D]);

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-grid-bg" aria-hidden />
      <div className="wrap hero-top">
        <div className="hero-copy">{copy}</div>
        <div className="hero-map" ref={mapRef} role="img" aria-label={MAP_LABEL} data-ready={ready ? "1" : "0"} onPointerEnter={() => { const now = Date.now(); if (now - lastPlay.current > 4000) { lastPlay.current = now; setResting(false); setReplay((r) => r + 1); } }}>
          <div className="map-fallback"><MapFallback /></div>
          {use3D && (
            <div className="map-3d">
              <HeroScene px={px} py={py} settle={settle} active={visible && !resting} replay={replay} onRest={() => setResting(true)} onReady={() => setReady(true)} labels={labels} />
              <div className="map-labels" ref={labels} aria-hidden>
                {DISTRICTS.map((d) => (<div className={`mlabel${d.key === "chennai" || d.key === "coimbatore" ? " left" : ""}`} key={d.key}><b>{d.name}</b><span>{d.court} · {d.time}</span></div>))}
              </div>
            </div>
          )}
          <span className="map-note">Offices &amp; hearings across Tamil Nadu · illustrative</span>
        </div>
      </div>
      <div className="wrap hero-stage">
        <motion.div className="hero-screen" style={reduce ? undefined : { rotateX, scale }}>{screen}</motion.div>
        <span className="sample-tag">Sample data</span>
      </div>
    </section>
  );
}
