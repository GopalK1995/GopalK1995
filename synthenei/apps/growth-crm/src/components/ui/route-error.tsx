"use client";
import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { docLang, errorCopy, errorId, humanMessage } from "@/lib/error-message";

/** Shared client boundary body: heading (h1, since a failed route has no heading of its own), human message, Retry, error id.
 * Never prints error.message or a stack; the raw text goes to the console only (server side: instrumentation.ts onRequestError). */
export function RouteError({ error, reset, source, homeHref, bare }: { error: Error & { digest?: string }; reset: () => void; source?: string; homeHref?: string; bare?: boolean }) {
  const [lang, setLang] = useState("en");
  const [fallbackId, setFallbackId] = useState("");
  useEffect(() => {
    setLang(docLang());
    const id = `c-${Math.random().toString(36).slice(2, 8)}`;
    setFallbackId(id);
    console.error("[page-error]", { id: error.digest ?? id, name: error.name, message: String(error.message ?? "").slice(0, 200) });
  }, [error]);
  const c = errorCopy(lang), id = errorId(error, fallbackId);
  const box = (
      <div role="alert" className="mx-auto mt-12 max-w-lg rounded-md border border-danger/25 bg-surface p-5 shadow-1">
        <h1 className="flex items-center gap-2 text-[16px] font-semibold text-danger"><TriangleAlert className="size-4 shrink-0" aria-hidden />{source ? c.boundarySourceTitle.replace("{source}", source) : c.boundaryTitle}</h1>
        <p className="mt-2 text-[13px] text-ink-2">{humanMessage(error, lang)}</p>
        {id && <p className="mt-1 font-mono text-[12px] text-ink-3">{c.boundaryId} {id}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={reset}>{c.boundaryRetry}</Button>
          {homeHref && <a href={homeHref} className="inline-flex h-9 items-center rounded-control border border-line px-3 text-[13px] font-medium text-ink hover:bg-paper">{c.boundaryHome}</a>}
        </div>
      </div>
  );
  return bare ? <main className="px-4">{box}</main> : box;
}
