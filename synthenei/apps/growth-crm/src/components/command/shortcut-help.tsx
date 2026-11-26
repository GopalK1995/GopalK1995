"use client";
// Keyboard shortcut help (WCAG 2.1.4). Opens with "?" (when single-key shortcuts are on), from the palette footer link, or via
// openShortcutHelp(). It also holds the switch that turns the single-key shortcuts off.
import * as D from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { openCommandPalette } from "./command-palette";
import { OPEN_SHORTCUTS_EVENT, PREF_EVENT, setSingleKeyEnabled, singleKeyAction, singleKeyEnabled } from "./shortcuts";

/** One global listener for the bare "/" and "?" keys, with every guard from shortcuts.ts. Mounted once by the shell. */
export function useSingleKeyShortcuts() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const a = singleKeyAction(e, singleKeyEnabled());
      if (!a) return;
      e.preventDefault();
      if (a === "search") openCommandPalette(); else window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
}

export function ShortcutHelp() {
  const t = useTranslations("search");
  const [open, setOpen] = useState(false);
  const [single, setSingle] = useState(true);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  const mod = mac ? "Cmd" : "Ctrl";

  useEffect(() => {
    const sync = () => setSingle(singleKeyEnabled());
    const show = () => { sync(); setOpen(true); };
    sync();
    window.addEventListener(OPEN_SHORTCUTS_EVENT, show); window.addEventListener(PREF_EVENT, sync);
    return () => { window.removeEventListener(OPEN_SHORTCUTS_EVENT, show); window.removeEventListener(PREF_EVENT, sync); };
  }, []);

  const rows: { keys: string[]; label: string; single?: boolean }[] = [
    { keys: [mod, "K"], label: t("scOpenSearch") },
    { keys: ["/"], label: t("scOpenSearchSlash"), single: true },
    { keys: ["?"], label: t("scHelp"), single: true },
    { keys: ["Up", "Down"], label: t("scMove") },
    { keys: ["Enter"], label: t("scOpen") },
    { keys: ["Esc"], label: t("scClose") },
  ];

  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-navy-950/45" />
        <D.Content className="fixed left-1/2 top-[12%] z-50 w-[calc(100vw-32px)] max-w-md -translate-x-1/2 rounded-control border border-line bg-surface p-4 shadow-pop focus:outline-none">
          <div className="flex items-start justify-between gap-3">
            <D.Title className="text-14 font-semibold text-ink">{t("shortcutsTitle")}</D.Title>
            <D.Close aria-label={t("shortcutsClose")} className="inline-flex size-8 items-center justify-center rounded-control text-ink-3 hover:bg-paper-2 focus-visible:ring-2 focus-visible:ring-ring"><X className="size-4" aria-hidden /></D.Close>
          </div>
          <D.Description className="mt-1 text-13 text-ink-3">{t("shortcutsDescription")}</D.Description>
          <ul className="mt-3 divide-y divide-line">
            {rows.map((r) => (
              <li key={r.label} className="flex items-center justify-between gap-3 py-2 text-13 text-ink">
                <span>{r.label}{r.single && !single ? <span className="ml-2 text-12 text-ink-3">{t("scOff")}</span> : null}</span>
                <span className="flex shrink-0 items-center gap-1">{r.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
              </li>
            ))}
          </ul>
          <label className="mt-4 flex items-start gap-2 text-13 text-ink">
            <input type="checkbox" checked={single} onChange={(e) => setSingleKeyEnabled(e.target.checked)} className="mt-0.5 size-4 shrink-0" />
            <span>{t("scSingleToggle")}<span className="block text-12 text-ink-3">{t("scSingleHint")}</span></span>
          </label>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
