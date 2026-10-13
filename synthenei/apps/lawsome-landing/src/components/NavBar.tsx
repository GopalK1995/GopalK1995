"use client";
import { useReduced } from "@/components/motion/useReduced";
import { motion, useScroll, useSpring } from "motion/react";
import { useEffect, useState } from "react";
import { CtaLink } from "./CtaLink";
import { EASE } from "./motion/ease";

const SECTIONS = [
  ["visibility", "Visibility"], ["hearings", "Hearings"], ["cases", "Cases"], ["team", "Team"], ["ecourts", "eCourts"], ["nidhi", "Ask Nidhi"],
] as const;

/** Sticky nav with the current section highlighted and a hairline reading-progress bar. */
export function NavBar() {
  const reduce = useReduced();
  const [active, setActive] = useState<string | null>(null);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 200, damping: 40, restDelta: 0.001 });

  useEffect(() => {
    const els = SECTIONS.map(([id]) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
    }, { rootMargin: "-45% 0px -50% 0px" });
    els.forEach((el) => io.observe(el));
    const top = () => { if (window.scrollY < 300) setActive(null); };
    window.addEventListener("scroll", top, { passive: true });
    return () => { io.disconnect(); window.removeEventListener("scroll", top); };
  }, []);

  const idx = SECTIONS.findIndex(([id]) => id === active);
  return (
    <header className="nav">
      <div className="wrap nav-in">
        <a className="logo" href="#top" aria-label="LAWSOME, back to top">LAWS<i>O</i>ME</a>
        <nav className="nav-links" aria-label="Sections">
          {SECTIONS.map(([id, label], i) => (
            <a key={id} href={`#${id}`} aria-current={active === id ? "true" : undefined} className={active === id ? "on" : undefined}>
              <span className="nav-n">{String(i + 1).padStart(2, "0")}</span>{label}
              {active === id && (reduce ? <span className="nav-mark" /> : <motion.span layoutId="nav-mark" className="nav-mark" transition={{ duration: 0.4, ease: EASE }} />)}
            </a>
          ))}
        </nav>
        <div className="nav-right">
          <span className="nav-count" aria-hidden>{idx >= 0 ? `${String(idx + 1).padStart(2, "0")} / 06` : ""}</span>
          <CtaLink where="nav" className="btn btn-primary btn-sm">Book a Live Demo</CtaLink>
        </div>
      </div>
      <motion.div className="nav-progress" style={{ scaleX: reduce ? scrollYProgress : progress }} aria-hidden />
    </header>
  );
}
