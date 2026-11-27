"use client";
// The links an owner shares: the organisation's own notice and request form, and the platform privacy policy. Each is a full URL
// with a Copy button and an Open link, so what is printed is what works when pasted into an email or a website footer.
import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface LinkItem { id: string; label: string; help: string; url: string | null; missing?: string }
export interface LinkStrings { copy: string; copied: string; copyFailed: string; open: string }

function Row({ item, s }: { item: LinkItem; s: LinkStrings }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    if (!item.url) return;
    try { await navigator.clipboard.writeText(item.url); setState("copied"); } catch { setState("failed"); }
    setTimeout(() => setState("idle"), 2500);
  };
  return (
    <div className="grid gap-1" data-testid={`public-link-${item.id}`}>
      <p className="text-13 font-medium text-ink">{item.label}</p>
      <p className="text-13 text-ink-2">{item.help}</p>
      {item.url ? (
        <div className="flex flex-wrap items-center gap-2">
          <input readOnly value={item.url} aria-label={item.label} onFocus={(e) => e.currentTarget.select()} data-testid={item.id === "notice" ? "public-path" : undefined}
            className="num h-8 min-w-0 flex-1 rounded-sm border border-field-line bg-paper-2 px-2 text-13 text-ink focus-ring sm:min-w-[22rem]" />
          <Button size="sm" onClick={copy}>{state === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}{state === "copied" ? s.copied : s.copy}</Button>
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 text-13 font-medium text-accent underline"><ExternalLink className="size-3.5" aria-hidden />{s.open}</a>
          <span role="status" className="sr-only">{state === "copied" ? s.copied : state === "failed" ? s.copyFailed : ""}</span>
          {state === "failed" && <span className="text-12 text-danger">{s.copyFailed}</span>}
        </div>
      ) : <p className="text-13 text-ink-3">{item.missing}</p>}
    </div>
  );
}

export function PublicLinks({ items, s }: { items: LinkItem[]; s: LinkStrings }) {
  return <div className="mb-4 grid gap-4 rounded-card border border-line bg-surface p-3">{items.map((i) => <Row key={i.id} item={i} s={s} />)}</div>;
}
