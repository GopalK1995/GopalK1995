import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE } from "@/i18n/registry";
import { OPEN_SHORTCUTS_EVENT, SINGLE_KEY_PREF, isEditableTarget, isInsideDialog, paletteChordAllowed, setSingleKeyEnabled, singleKeyAction, singleKeyEnabled } from "../shortcuts";
import { ShortcutHelp, useSingleKeyShortcuts } from "../shortcut-help";
import { OPEN_PALETTE_EVENT } from "../command-palette";

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); document.body.innerHTML = ""; });

const key = (k: string, target: EventTarget | null, o: Partial<KeyboardEvent> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, repeat: false, isComposing: false, target, ...o });
const el = (html: string) => { const d = document.createElement("div"); d.innerHTML = html; document.body.appendChild(d); return d.firstElementChild as HTMLElement; };

describe("single-key shortcut rules (WCAG 2.1.4)", () => {
  it("fires '/' for search and '?' for help on the page body", () => {
    expect(singleKeyAction(key("/", document.body), true)).toBe("search");
    expect(singleKeyAction(key("?", document.body), true)).toBe("help");
  });
  it("does nothing when switched off, with a modifier, on repeat, while composing or when already handled", () => {
    expect(singleKeyAction(key("/", document.body), false)).toBeNull();
    expect(singleKeyAction(key("/", document.body, { ctrlKey: true }), true)).toBeNull();
    expect(singleKeyAction(key("/", document.body, { metaKey: true }), true)).toBeNull();
    expect(singleKeyAction(key("/", document.body, { altKey: true }), true)).toBeNull();
    expect(singleKeyAction(key("/", document.body, { repeat: true }), true)).toBeNull();
    expect(singleKeyAction(key("/", document.body, { isComposing: true }), true)).toBeNull();
    expect(singleKeyAction(key("/", document.body, { defaultPrevented: true }), true)).toBeNull();
    expect(singleKeyAction(key("a", document.body), true)).toBeNull();
  });
  it("ignores every kind of form control, including select and ARIA textboxes", () => {
    for (const html of ["<input />", "<textarea></textarea>", "<select><option>a</option></select>", "<div role='textbox' tabindex='0'></div>", "<div role='combobox' tabindex='0'></div>", "<div contenteditable='true'>x</div>"]) {
      const t = el(html);
      expect(isEditableTarget(t), html).toBe(true);
      expect(singleKeyAction(key("/", t), true), html).toBeNull();
    }
  });
  it("ignores keys pressed inside a dialog or menu", () => {
    const d = el("<div role='dialog'><button id='b'>ok</button></div>");
    const b = d.querySelector("button")!;
    expect(isInsideDialog(b)).toBe(true);
    expect(singleKeyAction(key("/", b), true)).toBeNull();
    const m = el("<div role='menu'><button>m</button></div>");
    expect(singleKeyAction(key("?", m.firstElementChild), true)).toBeNull();
  });
  it("the preference defaults to on, persists, and survives blocked storage", () => {
    expect(singleKeyEnabled()).toBe(true);
    setSingleKeyEnabled(false);
    expect(localStorage.getItem(SINGLE_KEY_PREF)).toBe("off");
    expect(singleKeyEnabled()).toBe(false);
    setSingleKeyEnabled(true);
    expect(singleKeyEnabled()).toBe(true);
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(singleKeyEnabled()).toBe(true);
    spy.mockRestore();
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => setSingleKeyEnabled(false)).not.toThrow();
    set.mockRestore();
  });
  it("Cmd/Ctrl+K yields to an editor that handled it, and to contenteditable outside the palette", () => {
    expect(paletteChordAllowed({ defaultPrevented: true, target: document.body }, false)).toBe(false);
    const ed = el("<div contenteditable='true'><span>t</span></div>");
    expect(paletteChordAllowed({ defaultPrevented: false, target: ed.firstElementChild }, false)).toBe(false);
    expect(paletteChordAllowed({ defaultPrevented: false, target: ed }, true)).toBe(true);
    expect(paletteChordAllowed({ defaultPrevented: false, target: el("<input />") }, false)).toBe(true);
  });
});

function Probe() { useSingleKeyShortcuts(); return <input aria-label="field" />; }

describe("useSingleKeyShortcuts", () => {
  it("opens the palette on '/', the help on '?', and not while typing or when turned off", () => {
    const palette = vi.fn(), help = vi.fn();
    window.addEventListener(OPEN_PALETTE_EVENT, palette); window.addEventListener(OPEN_SHORTCUTS_EVENT, help);
    render(<Probe />);
    act(() => { fireEvent.keyDown(document.body, { key: "/" }); });
    expect(palette).toHaveBeenCalledTimes(1);
    act(() => { fireEvent.keyDown(document.body, { key: "?" }); });
    expect(help).toHaveBeenCalledTimes(1);
    act(() => { fireEvent.keyDown(screen.getByLabelText("field"), { key: "/" }); });
    expect(palette).toHaveBeenCalledTimes(1);
    setSingleKeyEnabled(false);
    act(() => { fireEvent.keyDown(document.body, { key: "/" }); fireEvent.keyDown(document.body, { key: "?" }); });
    expect(palette).toHaveBeenCalledTimes(1); expect(help).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_PALETTE_EVENT, palette); window.removeEventListener(OPEN_SHORTCUTS_EVENT, help);
  });
});

describe("ShortcutHelp", () => {
  const ui = () => <NextIntlClientProvider locale="en" messages={BASE.en as never}><ShortcutHelp /></NextIntlClientProvider>;
  it("lists the shortcuts and its toggle turns single-key shortcuts off and on", async () => {
    render(ui());
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => { window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT)); });
    const dlg = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dlg).toHaveTextContent("Open search and commands");
    expect(dlg).toHaveTextContent("Show this list");
    const box = screen.getByRole("checkbox", { name: /Single-key shortcuts/ });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(singleKeyEnabled()).toBe(false);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Single-key shortcuts/ })).not.toBeChecked());
    expect(dlg).toHaveTextContent("(off)");
    fireEvent.click(screen.getByRole("checkbox", { name: /Single-key shortcuts/ }));
    expect(singleKeyEnabled()).toBe(true);
  });
});
