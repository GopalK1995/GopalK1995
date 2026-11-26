"use client";
// Global search and command palette (T056). Cmd/Ctrl+K opens it from anywhere in the shell. cmdk provides the listbox keyboard model
// (arrows, Home/End, Enter, loop); filtering is done here (`shouldFilter={false}`) because records come from the server.
// The server decides what the viewer may see (actions, searchable types, rows); the client only filters what it was given.
import { Command as C } from "cmdk";
import * as D from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Building2, CalendarPlus, Clock, FileText, Loader2, Phone, Search, Upload, UserPlus, Users } from "lucide-react";
import { useSession, useVocab } from "@/components/shell/providers";
import { navFor, navLabel } from "@/components/shell/nav";
import { Kbd } from "@/components/ui/kbd";
import { MIN_QUERY, sanitizeQuery } from "@/lib/search/sanitize";
import { pushRecent, readRecent, type KeyValueStore } from "@/lib/search/recent";
import type { HitType, SearchAction, SearchHit, SearchResponse } from "@/lib/search/types";

export const OPEN_PALETTE_EVENT = "gcrm:open-palette";
/** Lets any control (for example the top-bar chip) open the palette without importing it. */
export const openCommandPalette = () => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
const DEBOUNCE_MS = 200;
const ACTION_ICON = { "new-lead": UserPlus, "log-call": Phone, "new-task": CalendarPlus, "import-leads": Upload } as const;
const HIT_ICON: Record<HitType, typeof Users> = { lead: Users, account: Building2, contact: Users, record: FileText };

type Status = "idle" | "loading" | "error" | "rate_limited" | "ready";
export type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<Pick<Response, "ok" | "status" | "json">>;

const storage = (): KeyValueStore | null => { try { return window.localStorage; } catch { return null; } };
const rowCls = "flex min-h-10 cursor-default items-center gap-2 rounded-chip px-2 py-1.5 text-13 text-ink data-[selected=true]:bg-paper-2";
const headCls = "[&_[cmdk-group-heading]]:label-caps [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5";

export function CommandPalette({ fetcher = fetch as unknown as Fetcher, debounceMs = DEBOUNCE_MS }: { fetcher?: Fetcher; debounceMs?: number }) {
  const t = useTranslations("search");
  const router = useRouter();
  const { uid, ws, role, tenant, objects } = useSession();
  const v = useVocab();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [boot, setBoot] = useState<SearchResponse | null>(null);
  const [partial, setPartial] = useState(false);
  const [recent, setRecent] = useState<SearchHit[]>([]);
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);

  const { q, tooShort } = useMemo(() => sanitizeQuery(input), [input]);

  // Open on Cmd/Ctrl+K (toggle) or on the custom event. Works while typing in a field, like most palettes.
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); } };
    const ev = () => setOpen(true);
    window.addEventListener("keydown", key); window.addEventListener(OPEN_PALETTE_EVENT, ev);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener(OPEN_PALETTE_EVENT, ev); };
  }, []);

  // On open: reset, load recent items and the bootstrap (actions + what the viewer may search).
  useEffect(() => {
    if (!open) return;
    setInput(""); setHits([]); setPartial(false); setStatus("idle");
    setRecent(readRecent(storage(), uid, ws.id));
    const ctl = new AbortController();
    setStatus("loading");
    fetcher("/api/search", { signal: ctl.signal }).then(async (r) => {
      if (r.status === 429) { setStatus("rate_limited"); return; }
      if (!r.ok) { setStatus("error"); return; }
      setBoot((await r.json()) as SearchResponse); setStatus("ready");
    }).catch((e) => { if ((e as { name?: string })?.name !== "AbortError") setStatus("error"); });
    return () => ctl.abort();
  }, [open, uid, ws.id, fetcher, attempt]);

  // Debounced search. A newer keystroke aborts the older request and a late answer is dropped.
  useEffect(() => {
    if (!open || q.length < MIN_QUERY) { setHits([]); setPartial(false); if (open && boot) setStatus("ready"); return; }
    const mine = ++seq.current;
    const ctl = new AbortController();
    setStatus("loading");
    const id = setTimeout(() => {
      fetcher(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then(async (r) => {
        if (mine !== seq.current) return;
        if (r.status === 429) { setStatus("rate_limited"); return; }
        if (!r.ok) { setStatus("error"); return; }
        const body = (await r.json()) as SearchResponse;
        if (mine !== seq.current) return;
        setHits(body.hits ?? []); setPartial(!!body.partial); setStatus("ready");
      }).catch((e) => { if (mine === seq.current && (e as { name?: string })?.name !== "AbortError") setStatus("error"); });
    }, debounceMs);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [q, open, fetcher, debounceMs, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((href: string, hit?: SearchHit) => {
    if (hit) setRecent(pushRecent(storage(), uid, ws.id, hit));
    setOpen(false);
    router.push(href);
  }, [router, uid, ws.id]);

  const needle = q.toLowerCase();
  const pages = useMemo(() => navFor(role, tenant, objects).flatMap((g) => g.items).map((i) => ({ href: i.href, label: navLabel(v, i), Icon: i.icon })), [role, tenant, objects, v]);
  const shownPages = needle ? pages.filter((p) => p.label.toLowerCase().includes(needle)) : pages.slice(0, 6);
  const actionLabel = (a: SearchAction) => a.id === "new-lead" ? t("newItem", { noun: v.n.lead.one }) : a.id === "log-call" ? t("logCall") : a.id === "new-task" ? t("newTask") : t("importItems", { nouns: v.n.lead.many });
  const shownActions = (boot?.actions ?? []).map((a) => ({ a, label: actionLabel(a) })).filter((x) => !needle || x.label.toLowerCase().includes(needle));
  // Recent items are only offered for types the server said the viewer may still search.
  const recentOk = recent.filter((h) => !!boot?.types?.includes(h.type) && (h.type !== "record" || (!!h.objectKey && !!boot?.objects?.includes(h.objectKey))));
  const hitLabel = (h: SearchHit) => (h.type === "lead" ? v.nav.leads : h.type === "account" ? v.nav.accounts : h.type === "contact" ? t("contacts") : (h.subtitle ?? t("results")));
  const searching = q.length >= MIN_QUERY;
  const nothing = status === "ready" && searching && !hits.length && !shownPages.length && !shownActions.length;

  const hitRow = (h: SearchHit): ReactNode => {
    const Icon = HIT_ICON[h.type];
    return (
      <C.Item key={h.key} value={h.key} onSelect={() => go(h.href, h)} className={rowCls}>
        <Icon className="size-4 shrink-0 text-ink-3" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{h.title}</span>
        {h.masked && <span className="shrink-0 text-12 text-ink-3">{t("masked")}</span>}
        {h.subtitle && h.type !== "record" && <span className="max-w-[45%] shrink-0 truncate text-12 text-ink-3">{h.subtitle}</span>}
        {h.type === "record" && <span className="shrink-0 text-12 text-ink-3">{hitLabel(h)}</span>}
      </C.Item>
    );
  };

  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-navy-950/45" />
        <D.Content className="fixed left-1/2 top-[12%] z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-control border border-line bg-surface shadow-pop focus:outline-none">
          <D.Title className="sr-only">{t("title")}</D.Title>
          <D.Description className="sr-only">{t("description")}</D.Description>
          <C label={t("title")} shouldFilter={false} loop>
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search className="size-4 shrink-0 text-ink-3" aria-hidden />
              <C.Input value={input} onValueChange={setInput} placeholder={t("placeholder")} maxLength={64} autoComplete="off" spellCheck={false}
                className="h-11 w-full bg-transparent text-14 text-ink focus-ring-inset placeholder:text-ink-3" />
              {status === "loading" && <Loader2 className="size-4 shrink-0 animate-spin text-ink-3" aria-hidden />}
            </div>
            <C.List className="max-h-[min(24rem,60vh)] overflow-y-auto p-1">
              {status === "loading" && searching && <div role="status" className="px-3 py-2 text-13 text-ink-3">{t("loading")}</div>}
              {status === "rate_limited" && <div role="alert" className="px-3 py-3 text-13 text-ink-2">{t("rateLimited")}</div>}
              {status === "error" && (
                <div role="alert" className="flex items-center gap-3 px-3 py-3 text-13 text-ink-2">
                  <span className="flex-1">{t("error")}</span>
                  <button type="button" onClick={() => setAttempt((n) => n + 1)} className="h-8 rounded-control border border-line-strong bg-surface px-2.5 text-13 text-ink hover:bg-paper-2">{t("retry")}</button>
                </div>
              )}
              {input && tooShort && <div role="status" className="px-3 py-2 text-13 text-ink-3">{t("tooShort", { n: MIN_QUERY })}</div>}
              {partial && <div role="status" className="px-3 py-2 text-12 text-ink-3">{t("partial")}</div>}
              {nothing && (
                <div className="px-3 py-6 text-center">
                  <p className="text-13 text-ink-2">{t("empty", { q })}</p>
                  <p className="mt-1 text-12 text-ink-3">{t("emptyHint")}</p>
                </div>
              )}
              {!searching && recentOk.length > 0 && <C.Group heading={t("recent")} className={headCls}>{recentOk.map((h) => (
                <C.Item key={`r-${h.key}`} value={`recent-${h.key}`} onSelect={() => go(h.href, h)} className={rowCls}>
                  <Clock className="size-4 shrink-0 text-ink-3" aria-hidden /><span className="min-w-0 flex-1 truncate">{h.title}</span>
                </C.Item>
              ))}</C.Group>}
              {hits.length > 0 && <C.Group heading={t("results")} className={headCls}>{hits.map(hitRow)}</C.Group>}
              {shownActions.length > 0 && <C.Group heading={t("actions")} className={headCls}>{shownActions.map(({ a, label }) => {
                const Icon = ACTION_ICON[a.id];
                return <C.Item key={a.id} value={`action-${a.id}`} onSelect={() => go(a.href)} className={rowCls}><Icon className="size-4 shrink-0 text-ink-3" aria-hidden /><span>{label}</span></C.Item>;
              })}</C.Group>}
              {shownPages.length > 0 && <C.Group heading={t("pages")} className={headCls}>{shownPages.map((p) => (
                <C.Item key={p.href} value={`page-${p.href}`} onSelect={() => go(p.href)} className={rowCls}><p.Icon className="size-4 shrink-0 text-ink-3" aria-hidden /><span>{p.label}</span></C.Item>
              ))}</C.Group>}
            </C.List>
            <div className="flex items-center justify-between border-t border-line px-3 py-1.5 text-12 text-ink-3"><span>{t("keys")}</span><Kbd>Esc</Kbd></div>
          </C>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
