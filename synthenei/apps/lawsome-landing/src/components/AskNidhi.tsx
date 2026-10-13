"use client";
import { useReduced } from "@/components/motion/useReduced";
import { AnimatePresence, LayoutGroup, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { DUR, EASE } from "./motion/ease";

const QUESTION = "We have received a new property dispute involving a disagreement over ownership and a registered sale deed. Find relevant cases already handled by our firm and identify potentially relevant external judgments for further review.";
const enter = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, transition: { duration: DUR.fast } }, transition: { duration: DUR.base, ease: EASE } };

export function AskNidhi() {
  const [step, setStep] = useState(0); // 0 idle, 1 question, 2 thinking, 3 answer
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReduced();
  const inView = useInView(ref, { once: true, amount: 0.35 });
  useEffect(() => {
    if (!inView) return;
    if (reduce) { setStep(3); return; }
    setStep(1);
    const a = setTimeout(() => setStep(2), 1200), b = setTimeout(() => setStep(3), 2700);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [inView, reduce]);
  const m = reduce ? { initial: false as const } : enter;
  return (
    <div className="nidhi" ref={ref}>
      <div className="nidhi-head"><span className="nidhi-dot" aria-hidden />Ask Nidhi <em>Illustrative conversation</em></div>
      <LayoutGroup>
        <div className="nidhi-body" aria-live="polite">
          <AnimatePresence initial={false} mode="popLayout">
            {step >= 1 && <motion.div key="q" layout={!reduce} className="bubble me" {...m}>{QUESTION}</motion.div>}
            {step === 2 && <motion.div key="t" layout={!reduce} className="bubble bot typing" aria-label="Ask Nidhi is preparing a response" {...m}><i /><i /><i /></motion.div>}
            {step >= 3 && (
              <motion.div key="a" layout={!reduce} className="bubble bot" {...m}>
                <div className="rsec"><b>1 · Internal case matches</b><p>Matters from your firm’s own records involving ownership and sale-deed disputes, each linked to its case record.</p>
                  <ul><li><span className="pill">Internal</span> Selvam vs Thangaraj (Sale Deed) <small>OS/387/2026 · Sub Court, Madurai</small></li><li><span className="pill">Internal</span> Menon Estates vs Kumar Builders <small>CS/142/2026 · Commercial Court, Chennai</small></li></ul></div>
                <div className="rsec"><b>2 · External judgments for review</b><p>Potentially relevant judgments with court, citation and source link — shown only when available and verified.</p>
                  <ul><li><span className="pill ok">External</span> Judgment title · Court · Year <small>Citation + source link appear here once verified</small></li></ul></div>
                <div className="rsec"><b>3 · Research summary</b><p>Facts, legal issues and points for the advocate to investigate further — to support preparation, not replace professional judgment.</p></div>
                <p className="verify">Advocates should verify all sources before relying on them.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </LayoutGroup>
    </div>
  );
}
