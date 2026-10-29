"use client";
// Command palette on cmdk inside a Radix dialog. The single raised surface while open.
import { Command as C } from "cmdk";
import * as D from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { Kbd } from "./kbd";

export type CommandItemDef = { id: string; label: string; hint?: string; keywords?: string[]; shortcut?: string; disabled?: boolean; group?: string };

export function Command({ open, onOpenChange, items, onSelect, placeholder = "Type a command or search", emptyText = "No results" }: {
  open: boolean; onOpenChange: (o: boolean) => void; items: CommandItemDef[]; onSelect: (id: string) => void; placeholder?: string; emptyText?: string;
}) {
  const groups = Array.from(new Set(items.map((i) => i.group ?? "")));
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-navy-950/45 data-[state=open]:animate-[fade_150ms_ease-out]" />
        <D.Content className="fixed left-1/2 top-[18%] z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-control border border-line bg-surface shadow-pop focus:outline-none">
          <D.Title className="sr-only">Command palette</D.Title>
          <D.Description className="sr-only">Search commands and press Enter to run one</D.Description>
          <C label="Command palette" loop>
            <C.Input placeholder={placeholder} className="h-11 w-full border-b border-line bg-transparent px-4 text-14 text-ink outline-none placeholder:text-ink-3" />
            <C.List className="max-h-80 overflow-y-auto p-1">
              <C.Empty className="px-3 py-6 text-center text-13 text-ink-3">{emptyText}</C.Empty>
              {groups.map((g) => (
                <C.Group key={g} heading={g || undefined} className="[&_[cmdk-group-heading]]:label-caps [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                  {items.filter((i) => (i.group ?? "") === g).map((i) => (
                    <C.Item key={i.id} value={`${i.label} ${(i.keywords ?? []).join(" ")}`} disabled={i.disabled} onSelect={() => { onSelect(i.id); onOpenChange(false); }}
                      className="flex h-9 cursor-default items-center gap-2 rounded-chip px-2 text-13 text-ink data-[disabled=true]:opacity-45 data-[selected=true]:bg-paper-2">
                      <span>{i.label}</span>
                      {i.hint && <span className="text-12 text-ink-3">{i.hint}</span>}
                      {i.shortcut && <Kbd className="ml-auto">{i.shortcut}</Kbd>}
                    </C.Item>
                  ))}
                </C.Group>
              ))}
            </C.List>
          </C>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Small trigger chip that shows the shortcut, for the top bar. */
export function CommandChip({ onClick, children = "Search", shortcut = "⌘K" }: { onClick: () => void; children?: ReactNode; shortcut?: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-8 items-center gap-2 rounded-control border border-line-strong bg-surface px-2.5 text-13 text-ink-2 hover:bg-paper-2">
      {children}<Kbd>{shortcut}</Kbd>
    </button>
  );
}
