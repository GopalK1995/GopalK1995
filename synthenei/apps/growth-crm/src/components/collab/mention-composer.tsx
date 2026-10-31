"use client";
// Textarea with @mention autocomplete. The visible text holds "@Name"; picked people are remembered and converted to
// stored tokens on submit. The server lists only people who can read the record and re-checks every mention on save.
import { useEffect, useId, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { mentionToken } from "@/lib/notify/mentions";
import { COMMENT_MAX, type Mentionable } from "@/lib/notify/types";
import { searchMentionable } from "./actions";
import { fill, type Strings } from "./strings";

export function toStoredBody(text: string, picked: Mentionable[]): string {
  let out = text;
  // longest names first so "Priya Raman" is replaced before "Priya"
  for (const m of [...picked].sort((a, b) => b.name.length - a.name.length)) out = out.split(`@${m.name}`).join(mentionToken(m));
  return out;
}

export function MentionComposer({ objectType, objectId, s, value, onChange, picked, onPick, disabled, autoFocus }: {
  objectType: string; objectId: string; s: Strings; value: string; onChange: (v: string) => void;
  picked: Mentionable[]; onPick: (m: Mentionable) => void; disabled?: boolean; autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [q, setQ] = useState<string | null>(null);
  const [people, setPeople] = useState<Mentionable[] | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (q === null) return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await searchMentionable({ objectType, objectId, q });
      if (live) { setPeople(r.ok ? r.data?.people ?? [] : []); setActive(0); }
    }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [q, objectType, objectId]);

  const detect = (text: string, caret: number) => {
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, caret));
    setQ(m ? m[2] : null);
    if (!m) setPeople(null);
  };
  const choose = (p: Mentionable) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@[^\s@]{0,30}$/, `@${p.name} `);
    onChange(before + value.slice(caret));
    onPick(p);
    setQ(null); setPeople(null);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(before.length, before.length); });
  };
  const open = q !== null && people !== null;

  return (
    <div className="relative">
      <textarea
        ref={ref} className="min-h-20 w-full rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-13 text-ink placeholder:text-ink-3 disabled:opacity-45" value={value} rows={3} maxLength={COMMENT_MAX} disabled={disabled} autoFocus={autoFocus}
        aria-label={s.composerLabel} placeholder={s.composerPlaceholder}
        role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        onChange={(e) => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }}
        onKeyDown={(e) => {
          if (!open || !people?.length) { if (e.key === "Escape") setQ(null); return; }
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % people.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a + people.length - 1) % people.length); }
          else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(people[active]); }
          else if (e.key === "Escape") setQ(null);
        }}
      />
      {open && (
        <ul id={listId} role="listbox" aria-label={s.mentionHint} className="absolute left-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-control border border-line-strong bg-surface text-13 shadow-pop">
          {people.length === 0 ? (
            <li role="option" aria-selected={false} aria-disabled className="px-3 py-2 text-12 text-ink-3">{s.mentionNobody}</li>
          ) : people.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button type="button" tabIndex={-1} onMouseDown={(e) => { e.preventDefault(); choose(p); }}
                className={`flex h-8 w-full items-center gap-2 px-3 text-left ${i === active ? "bg-paper-2" : ""}`}>
                <Avatar name={p.name} size={20} /><span className="truncate">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-12 text-ink-3">{fill(s.mentionHint, {})}</p>
    </div>
  );
}
