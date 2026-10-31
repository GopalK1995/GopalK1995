"use client";
// "Priya is editing Stage" next to a field. Shows editors of `field` only; text, not motion.
import { Pencil } from "lucide-react";
import type { Editor } from "@/lib/realtime/hooks";
import { EN, fill, type RealtimeStrings } from "./strings";

export function EditingIndicatorView({ editors, field, fieldLabel, labels = EN }: { editors: readonly Editor[]; field: string; fieldLabel?: string; labels?: RealtimeStrings }) {
  const here = editors.filter((e) => e.field === field);
  if (here.length === 0) return null;
  const text = here.length === 1 ? fill(labels.editing, { name: here[0].name, field: fieldLabel ?? field }) : fill(labels.editingMany, { n: here.length });
  return <span role="status" aria-live="polite" data-testid="editing-indicator" className="inline-flex items-center gap-1 text-12 text-ink-2"><Pencil className="size-3" aria-hidden />{text}</span>;
}
