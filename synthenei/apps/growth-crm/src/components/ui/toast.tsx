"use client";
import { AnimatePresence, motion } from "motion/react";
import { CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";

type T = { id: number; msg: string; sub?: string };
/** Fire-and-forget toast. Demo writes never persist, and every toast says so. */
export function toast(msg: string, sub = "Demo: nothing was saved or sent.") {
  window.dispatchEvent(new CustomEvent("gcrm-toast", { detail: { msg, sub } }));
}
export function Toaster() {
  const [items, set] = useState<T[]>([]);
  useEffect(() => {
    let n = 0;
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { msg: string; sub?: string };
      const id = ++n;
      set((xs) => [...xs.slice(-2), { id, ...d }]);
      setTimeout(() => set((xs) => xs.filter((x) => x.id !== id)), 3600);
    };
    window.addEventListener("gcrm-toast", h); return () => window.removeEventListener("gcrm-toast", h);
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-20 right-4 z-[60] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2 lg:bottom-6">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}
            className="pointer-events-auto flex items-start gap-2.5 rounded-md bg-navy-900 px-3.5 py-3 text-navy-ink shadow-pop">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-accent-on-navy" aria-hidden />
            <div className="text-[13px] leading-5"><div className="font-medium">{t.msg}</div>{t.sub && <div className="text-[12px] text-navy-ink-3">{t.sub}</div>}</div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
