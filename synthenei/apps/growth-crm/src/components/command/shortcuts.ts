// Keyboard shortcut rules for the shell (WCAG 2.1.4 Character Key Shortcuts).
// Cmd/Ctrl+K is the primary shortcut (it uses a modifier, so it is compliant on its own). The bare "/" and "?" keys are single-key
// shortcuts: they only fire when focus is not in a form control, an editable region or a dialog, and the user can switch them off
// (preference kept in localStorage; every read and write is guarded because storage can be blocked).
export const SINGLE_KEY_PREF = "gcrm:single-key-shortcuts";
export const PREF_EVENT = "gcrm:shortcut-pref";
export const OPEN_SHORTCUTS_EVENT = "gcrm:open-shortcuts";
/** Lets any control (for example the palette footer) open the shortcut help without importing it. */
export const openShortcutHelp = () => window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT));

const store = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

/** On by default; only an explicit "off" disables the single-key shortcuts. */
export function singleKeyEnabled(): boolean {
  try { return store()?.getItem(SINGLE_KEY_PREF) !== "off"; } catch { return true; }
}
export function setSingleKeyEnabled(on: boolean): void {
  try { store()?.setItem(SINGLE_KEY_PREF, on ? "on" : "off"); } catch { /* storage blocked: the choice lasts for this page only */ }
  window.dispatchEvent(new Event(PREF_EVENT));
}

const FORM_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "OPTION"]);
const roleSel = ["textbox", "combobox", "searchbox", "spinbutton", "listbox", "slider"].map((r) => `[role="${r}"]`).join(",");
const EDITABLE_SEL = "[contenteditable=''],[contenteditable='true']";

const isContentEditable = (t: HTMLElement) => t.isContentEditable || !!t.closest(EDITABLE_SEL);

/** True when the key press belongs to an editable control (typing must never be hijacked). */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return FORM_TAGS.has(t.tagName) || isContentEditable(t) || !!t.closest(roleSel);
}
/** True when focus sits inside a dialog or popup, where a page-level shortcut must not fire. */
export function isInsideDialog(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return !!t.closest('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog,[role="menu"],[role="listbox"]');
}

export type SingleKey = "search" | "help";
type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "defaultPrevented" | "repeat" | "isComposing" | "target">;
/** Decide whether a keydown is one of the single-key shortcuts. Pure: the caller supplies the preference. */
export function singleKeyAction(e: KeyLike, enabled: boolean): SingleKey | null {
  if (!enabled || e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key !== "/" && e.key !== "?") return null;
  if (isEditableTarget(e.target) || isInsideDialog(e.target)) return null;
  return e.key === "/" ? "search" : "help";
}

/** Cmd/Ctrl+K must not take over rich-text editors, where it means "insert link" and the editor handles it first. */
export function paletteChordAllowed(e: Pick<KeyboardEvent, "defaultPrevented" | "target">, insidePalette: boolean): boolean {
  if (e.defaultPrevented) return false;
  if (insidePalette) return true;
  return !(e.target instanceof HTMLElement && isContentEditable(e.target));
}
