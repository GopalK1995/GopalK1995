"use client";
import { useEffect, useState, type ReactNode } from "react";
import { track } from "@/lib/track";

export type Slide = { key: string; label: string; caption: string; node: ReactNode };

// A self-playing "video-style" walkthrough of the product screens (about 60s end to end).
export function Tour({ slides, seconds = 10 }: { slides: Slide[]; seconds?: number }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setI((n) => (n + 1) % slides.length), seconds * 1000);
    return () => clearTimeout(t);
  }, [i, playing, seconds, slides.length]);
  const s = slides[i];
  return (
    <div>
      <div className="tourbar" role="tablist" aria-label="Product tour">
        {slides.map((x, n) => (
          <button key={x.key} role="tab" aria-pressed={n === i} onClick={() => { setI(n); setPlaying(false); track("tour_play", { slide: x.key }); }}>{n + 1}. {x.label}</button>
        ))}
        <button onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause tour" : "Play tour"}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
      </div>
      <div key={s.key} style={{ animation: "rise .4s ease both" }}>{s.node}</div>
      <p style={{ marginTop: 14, fontWeight: 600, color: "var(--c-navy-700)" }}>{s.caption}</p>
      <div style={{ height: 3, background: "var(--c-line)", borderRadius: 3, marginTop: 10, overflow: "hidden" }} aria-hidden>
        <div key={`${i}-${playing}`} style={{ height: "100%", background: "var(--c-blue-600)", width: playing ? "100%" : "0%", transition: playing ? `width ${seconds}s linear` : "none", animation: "none" }} ref={(el) => { if (el && playing) { el.style.width = "0%"; requestAnimationFrame(() => requestAnimationFrame(() => { el.style.width = "100%"; })); } }} />
      </div>
    </div>
  );
}
