"use client";
import { useEffect, useRef, useState } from "react";

const QUESTION = "We have received a new property dispute involving a disagreement over ownership and a registered sale deed. Find relevant cases already handled by our firm and identify potentially relevant external judgments for further review.";

export function AskNidhi() {
  const [step, setStep] = useState(0); // 0 idle, 1 question, 2 thinking, 3 answer
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      if (reduce) { setStep(3); return; }
      setStep(1); setTimeout(() => setStep(2), 1400); setTimeout(() => setStep(3), 3000);
    }, { threshold: 0.35 });
    io.observe(el); return () => io.disconnect();
  }, []);
  return (
    <div className="nidhi" ref={ref}>
      <div className="nidhi-head"><span className="nidhi-dot" />Ask Nidhi <em>Illustrative conversation</em></div>
      <div className="nidhi-body" aria-live="polite">
        {step >= 1 && <div className="bubble me">{QUESTION}</div>}
        {step === 2 && <div className="bubble bot typing"><i /><i /><i /></div>}
        {step >= 3 && (
          <div className="bubble bot">
            <div className="rsec"><b>1 · Internal case matches</b><p>Matters from your firm’s own records involving ownership and sale-deed disputes, each linked to its case record.</p>
              <ul><li><span className="pill">Internal</span> Selvam vs Thangaraj (Sale Deed) <small>OS/387/2026 · Sub Court, Madurai</small></li><li><span className="pill">Internal</span> Menon Estates vs Kumar Builders <small>CS/142/2026 · Commercial Court, Chennai</small></li></ul></div>
            <div className="rsec"><b>2 · External judgments for review</b><p>Potentially relevant judgments with court, citation and source link — shown only when available and verified.</p>
              <ul><li><span className="pill ok">External</span> Judgment title · Court · Year <small>Citation + source link appear here once verified</small></li></ul></div>
            <div className="rsec"><b>3 · Research summary</b><p>Facts, legal issues and points for the advocate to investigate further — to support preparation, not replace professional judgment.</p></div>
          </div>
        )}
      </div>
    </div>
  );
}
