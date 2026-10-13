"use client";
import { useReduced } from "@/components/motion/useReduced";
import { AnimatePresence, motion, useInView } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { track } from "@/lib/track";
import { DUR, EASE } from "./motion/ease";

export type Slide = { key: string; label: string; caption: string; node: ReactNode };

const Icon = ({ playing }: { playing: boolean }) => playing
  ? <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><rect x="2" y="1.5" width="2.6" height="9" rx=".6" fill="currentColor" /><rect x="7.4" y="1.5" width="2.6" height="9" rx=".6" fill="currentColor" /></svg>
  : <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M3 1.6v8.8a.6.6 0 0 0 .9.5l7-4.4a.6.6 0 0 0 0-1L3.9 1.1a.6.6 0 0 0-.9.5Z" fill="currentColor" /></svg>;

// A self-playing walkthrough of the product screens (about 50s end to end). Plays only while on screen.
export function Tour({ slides, seconds = 10 }: { slides: Slide[]; seconds?: number }) {
  const reduce = useReduced();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const running = playing && inView && !reduce;
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setI((n) => (n + 1) % slides.length), seconds * 1000);
    return () => clearTimeout(t);
  }, [i, running, seconds, slides.length]);
  const s = slides[i];
  return (
    <div ref={ref}>
      <div className="tourbar">
        <div role="tablist" aria-label="Product tour" className="tour-tabs">
          {slides.map((x, n) => (
            <button key={x.key} role="tab" aria-selected={n === i} aria-controls="tour-panel" onClick={() => { setI(n); setPlaying(false); track("tour_play", { slide: x.key }); }}>
              <span className="tour-n">{String(n + 1).padStart(2, "0")}</span>{x.label}
              {n === i && !reduce && <motion.span layoutId="tour-mark" className="tour-mark" transition={{ duration: DUR.base, ease: EASE }} />}
            </button>
          ))}
        </div>
        {!reduce && <button className="tour-play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause tour" : "Play tour"}><Icon playing={playing} />{playing ? "Pause" : "Play"}</button>}
      </div>
      <div className="tour-stage" id="tour-panel" role="tabpanel" aria-label={s.label}>
        <AnimatePresence initial={false}>
          <motion.div key={s.key} className="tour-slide"
            initial={reduce ? false : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={reduce ? undefined : { opacity: 0, x: -24 }}
            transition={{ duration: DUR.slow, ease: EASE }}>
            {s.node}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="tour-foot">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p key={s.key} className="tour-cap" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -6 }} transition={{ duration: DUR.fast, ease: EASE }}>{s.caption}</motion.p>
        </AnimatePresence>
        <div className="tour-track" aria-hidden>
          <motion.div key={`${i}-${running}`} className="tour-fill"
            initial={{ scaleX: 0 }} animate={{ scaleX: running ? 1 : 0 }} transition={{ duration: running ? seconds : 0, ease: "linear" }} />
        </div>
      </div>
    </div>
  );
}
