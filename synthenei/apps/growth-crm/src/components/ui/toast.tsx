"use client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export type ToastVariant = "success" | "error" | "warning" | "info";
export interface ToastAction { label: string; onClick: () => void }
export interface ToastOptions {
  variant?: ToastVariant;
  /** Optional action, for example Undo. Running it dismisses the toast. */
  action?: ToastAction;
  /** Only demo mode sets this: adds the "nothing was saved or sent" notice. */
  demo?: boolean;
  /** Overrides the auto-dismiss time (ms). Errors never auto-dismiss. */
  duration?: number;
}

export const DEMO_NOTICE = "Demo: nothing was saved or sent.";
/** Auto-dismiss times. Long enough to read and reach, and paused while hovered or focused. */
export const TOAST_MS: Record<ToastVariant, number | null> = { success: 6000, info: 6000, warning: 9000, error: null };
const MAX_VISIBLE = 3;

type Detail = { msg: string; sub?: string } & ToastOptions;
type T = Detail & { id: number; variant: ToastVariant };

/** Fire-and-forget toast. No default sub-line; pass `{ demo: true }` from demo mode to add the demo notice. */
export function toast(msg: string, sub?: string, opts: ToastOptions = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("gcrm-toast", { detail: { msg, sub: sub || undefined, ...opts } satisfies Detail }));
}
/** Toast for a server-action result: the variant follows `ok`, so a failed action never shows a success icon. */
export function toastResult(r: { ok: boolean; message: string; sub?: string; detail?: string }, opts: Omit<ToastOptions, "variant"> = {}) {
  toast(r.message, r.sub ?? r.detail, { ...opts, variant: r.ok ? "success" : "error" });
}

const ICON = { success: CircleCheck, error: CircleAlert, warning: TriangleAlert, info: Info } as const;
const ICON_COLOR: Record<ToastVariant, string> = {
  success: "text-accent-on-navy", error: "text-danger-soft", warning: "text-warn-soft", info: "text-info-soft",
};
const LABEL: Record<ToastVariant, string> = { success: "Success", error: "Error", warning: "Warning", info: "Notice" };

function ToastItem({ t, onDone, reduce }: { t: T; onDone: (id: number) => void; reduce: boolean }) {
  const total = t.duration ?? TOAST_MS[t.variant];
  const left = useRef<number | null>(total);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = useRef(false);
  const focused = useRef(false);

  const stop = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (left.current !== null && started.current) left.current = Math.max(0, left.current - (Date.now() - started.current));
    started.current = 0;
  }, []);
  const start = useCallback(() => {
    if (left.current === null || timer.current || hovered.current || focused.current) return;
    started.current = Date.now();
    timer.current = setTimeout(() => onDone(t.id), left.current);
  }, [onDone, t.id]);
  useEffect(() => { start(); return () => { if (timer.current) clearTimeout(timer.current); timer.current = null; }; }, [start]);

  const Icon = ICON[t.variant];
  const close = () => onDone(t.id);
  return (
    <motion.div layout={!reduce}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }} animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0 : 0.18, ease: "easeOut" }}
      data-testid="toast" data-variant={t.variant}
      onMouseEnter={() => { hovered.current = true; stop(); }}
      onMouseLeave={() => { hovered.current = false; start(); }}
      onFocusCapture={() => { focused.current = true; stop(); }}
      onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { focused.current = false; start(); } }}
      onKeyDown={(e) => { if (e.key === "Escape") close(); }}
      className="pointer-events-auto flex items-start gap-2.5 rounded-md bg-navy-900 px-3.5 py-3 text-navy-ink shadow-pop">
      <Icon className={`mt-0.5 size-4 shrink-0 ${ICON_COLOR[t.variant]}`} aria-hidden />
      <div className="min-w-0 flex-1 text-[13px] leading-5">
        <div className="font-medium"><span className="sr-only">{LABEL[t.variant]}: </span>{t.msg}</div>
        {t.sub && <div className="text-[12px] text-navy-ink-3">{t.sub}</div>}
        {t.demo && <div className="text-[12px] text-navy-ink-3">{DEMO_NOTICE}</div>}
        {t.action && (
          <button type="button" onClick={() => { t.action?.onClick(); close(); }}
            className="mt-1 rounded-sm text-[13px] font-medium text-accent-on-navy underline underline-offset-2 hover:text-navy-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-on-navy">
            {t.action.label}
          </button>
        )}
      </div>
      <button type="button" aria-label="Dismiss notification" onClick={close}
        className="-mr-1 -mt-0.5 grid size-7 shrink-0 place-items-center rounded-sm text-navy-ink-2 hover:text-navy-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-on-navy">
        <X className="size-4" aria-hidden />
      </button>
    </motion.div>
  );
}

export function Toaster() {
  const [items, set] = useState<T[]>([]);
  const reduce = !!useReducedMotion();
  const done = useCallback((id: number) => set((xs) => xs.filter((x) => x.id !== id)), []);
  useEffect(() => {
    let n = 0;
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as Detail;
      set((xs) => [...xs.slice(-(MAX_VISIBLE - 1)), { ...d, id: ++n, variant: d.variant ?? "info" }]);
    };
    window.addEventListener("gcrm-toast", h); return () => window.removeEventListener("gcrm-toast", h);
  }, []);
  // Two permanent live regions so announcements are reliable: errors interrupt (alert), everything else waits (status).
  const region = (role: "status" | "alert", list: T[]) => (
    <div role={role} aria-live={role === "alert" ? "assertive" : "polite"} aria-atomic="false" className="flex flex-col gap-2" data-region={role}>
      <AnimatePresence>{list.map((t) => <ToastItem key={t.id} t={t} onDone={done} reduce={reduce} />)}</AnimatePresence>
    </div>
  );
  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-[60] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2 lg:bottom-6">
      {region("alert", items.filter((t) => t.variant === "error"))}
      {region("status", items.filter((t) => t.variant !== "error"))}
    </div>
  );
}
