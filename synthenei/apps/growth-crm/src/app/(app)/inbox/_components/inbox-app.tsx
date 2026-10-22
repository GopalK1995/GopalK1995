"use client";
import Link from "next/link";
import { ArrowLeft, Check, CheckCheck, CircleAlert, Clock, Info, Link2, Lock, NotebookPen, Send, UserRoundCog, X, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Badge, StatusChip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/tabs";
import { ScoreChip } from "@/components/ui/misc";
import { ChannelMark } from "@/components/ui/domain";
import { Avatar } from "@/components/ui/avatar";
import { toast } from "@/components/ui/toast";
import { useVocab } from "@/components/shell/providers";
import { fmtDate, fmtTime, inrCompact, relTime, dayKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Gated } from "../../accounts/_components/gated";
import type { Verdict } from "../../accounts/_components/perms";
import { assignConversation, closeConversation, linkConversation, sendMessage } from "../actions";

type Ch = "whatsapp" | "email" | "linkedin";
type Msg = { id: string; from: "lead" | "us" | "note"; at: string; body: string; status?: "read" | "delivered" | "sent" | "simulated"; author: string; template?: string };
export type InboxConv = {
  id: string; channel: Ch; subject: string; unread: number; lastAt: string; messages: Msg[];
  draft: { en: string; ta: string | null; rationale: string[]; basedOn: string; needsReview: string | null };
  lead: { id: string; name: string; first: string; title: string; stage: string; score: number; ownerId: string; ownerName: string; consent: { followup: boolean; marketing: boolean; whatsapp: boolean; at: string }; phone: string; email: string };
  firm: { id: string; name: string; district: string; lawyers: number } | null;
  deal: { id: string; stage: string; value: number; plan: string; seats: number } | null;
  windowLeftH: number | null; mine: boolean; reply: Verdict;
};
const CH_LABEL: Record<Ch, string> = { whatsapp: "WhatsApp", email: "Email", linkedin: "LinkedIn" };
const CH_INTEGRATION: Record<Ch, string> = { whatsapp: "whatsapp", email: "gmail", linkedin: "linkedin" };
const field = "w-full rounded-sm border border-line-strong bg-surface px-2.5 text-[13px] outline-none focus:border-ring";

export function InboxApp({ items, now, linkable, reps, uid, assign, readOnlyRole }: {
  items: InboxConv[]; now: string; linkable: { id: string; label: string }[]; reps: { id: string; name: string }[]; uid: string; assign: Verdict; readOnlyRole: boolean;
}) {
  const vv = useVocab();
  const [filter, setFilter] = useState<"all" | "unread" | "mine">("all");
  const [chs, setChs] = useState<Ch[]>([]);
  const [sel, setSel] = useState<string | null>(items[0]?.id ?? null);
  const [mobileThread, setMobileThread] = useState(false);
  const [read, setRead] = useState<Record<string, boolean>>({});
  const [sent, setSent] = useState<Record<string, Msg[]>>({});
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  const list = items.filter((c) => (filter === "all" || (filter === "unread" ? c.unread > 0 && !read[c.id] : c.lead.ownerId === uid)) && (!chs.length || chs.includes(c.channel)));
  const cur = items.find((c) => c.id === sel) ?? null;
  const open = (id: string) => { setSel(id); setRead((r) => ({ ...r, [id]: true })); setMobileThread(true); };
  const counts = { all: items.length, unread: items.filter((c) => c.unread > 0 && !read[c.id]).length, mine: items.filter((c) => c.lead.ownerId === uid).length };

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface shadow-1 md:grid md:h-[calc(100dvh-14rem)] md:min-h-[600px] md:grid-cols-[288px_minmax(0,1fr)] xl:grid-cols-[312px_minmax(0,1fr)_288px]">
      {/* List */}
      <section aria-label="Conversations" className={cn("flex min-h-0 flex-col border-line md:border-r", mobileThread && "hidden md:flex")}>
        <div className="space-y-2 border-b border-line p-3">
          <div role="tablist" aria-label="Filter conversations" className="flex gap-1">
            {(["all", "unread", "mine"] as const).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
                className={cn("h-8 rounded-sm px-2.5 text-[12px] font-medium transition-colors duration-150", filter === f ? "bg-navy-900 text-navy-ink" : "text-ink-2 hover:bg-paper-2")}>
                {f === "all" ? "All" : f === "unread" ? "Unread" : "Mine"} <span className="num opacity-70">{counts[f]}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="Channels">
            {(vv.ib.channels as Ch[]).map((ch) => {
              const on = chs.includes(ch);
              return (
                <button key={ch} aria-pressed={on} onClick={() => setChs((x) => (on ? x.filter((y) => y !== ch) : [...x, ch]))}
                  className={cn("inline-flex h-7 items-center gap-1 rounded-full border pl-1 pr-2.5 text-[12px] transition-colors duration-150", on ? "border-accent bg-accent-soft text-accent-strong" : "border-line-strong text-ink-2 hover:bg-paper-2")}>
                  <ChannelMark channel={ch} />{CH_LABEL[ch]}
                </button>
              );
            })}
          </div>
        </div>
        <ul className="scrollbar-thin min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {list.map((c) => {
            const last = [...c.messages, ...(sent[c.id] ?? [])].at(-1)!;
            const unread = c.unread > 0 && !read[c.id];
            return (
              <li key={c.id}>
                <button onClick={() => open(c.id)} aria-current={sel === c.id ? "true" : undefined}
                  className={cn("relative block w-full px-3 py-3 text-left transition-colors duration-150 hover:bg-paper/70", sel === c.id && "bg-accent-soft/60 md:before:absolute md:before:inset-y-0 md:before:left-0 md:before:w-0.5 md:before:bg-accent")}>
                  <div className="flex items-center gap-2">
                    <ChannelMark channel={c.channel} />
                    <span className={cn("min-w-0 flex-1 truncate text-[13px]", unread ? "font-semibold text-ink" : "font-medium text-ink")}>{c.lead.name}</span>
                    <span className="shrink-0 text-[11px] text-ink-3 num">{relTime(last.at, now)}</span>
                  </div>
                  <div className="mt-0.5 truncate pl-7 text-[12px] text-ink-3">{c.firm?.name}</div>
                  <div className="mt-1 flex items-center gap-2 pl-7">
                    <p className={cn("min-w-0 flex-1 truncate text-[12px]", unread ? "text-ink" : "text-ink-2")}>{last.from === "us" ? "You: " : ""}{last.body}</p>
                    {unread && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-semibold text-accent-ink num" aria-label={`${c.unread} unread`}>{c.unread}</span>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-7">
                    {c.windowLeftH !== null && <WindowChip h={c.windowLeftH} />}
                    {closed[c.id] && <Badge tone="outline">Closed</Badge>}
                    <span className="text-[11px] text-ink-3">{c.lead.ownerName.split(" ")[0]}</span>
                  </div>
                </button>
              </li>
            );
          })}
          {!list.length && (
            <li className="px-4 py-10 text-center">
              <p className="text-[13px] font-medium text-ink">{items.length ? "No conversations match these filters." : "No conversations yet."}</p>
              <p className="mt-1 text-[12px] text-ink-3">{items.length ? "Clear the channel chips to see everything." : "Replies to WhatsApp templates and campaign emails will land here."}</p>
              {items.length > 0 && <Button size="sm" variant="ghost" className="mt-3" onClick={() => { setChs([]); setFilter("all"); }}>Show all</Button>}
            </li>
          )}
        </ul>
      </section>

      {/* Thread */}
      <section aria-label="Thread" className={cn("min-h-0 min-w-0 flex-col", mobileThread ? "flex" : "hidden md:flex")}>
        {cur ? <Thread key={cur.id} c={cur} now={now} extra={sent[cur.id] ?? []} closed={!!closed[cur.id]} readOnlyRole={readOnlyRole}
          onBack={() => setMobileThread(false)}
          onSent={(m) => setSent((s) => ({ ...s, [cur.id]: [...(s[cur.id] ?? []), m] }))}
          context={<ContextPanel c={cur} linkable={linkable} reps={reps} assign={assign} onClosed={() => setClosed((x) => ({ ...x, [cur.id]: true }))} />} />
          : <div className="grid flex-1 place-items-center p-8 text-center text-[13px] text-ink-3">Pick a conversation on the left.</div>}
      </section>

      {/* Context (xl) */}
      <aside aria-label="Lead context" className="hidden min-h-0 overflow-y-auto border-l border-line xl:block">
        {cur && <ContextPanel c={cur} linkable={linkable} reps={reps} assign={assign} onClosed={() => setClosed((x) => ({ ...x, [cur.id]: true }))} />}
      </aside>
    </div>
  );
}

function WindowChip({ h }: { h: number }) {
  if (h <= 0) return <Badge tone="outline"><Lock aria-hidden />Window closed · templates only</Badge>;
  return <Badge tone={h < 4 ? "warn" : "neutral"}><Clock aria-hidden />{h < 1 ? `${Math.max(1, Math.round(h * 60))} min left` : `${Math.floor(h)} h left`}</Badge>;
}

function Ticks({ s }: { s?: Msg["status"] }) {
  if (!s) return null;
  if (s === "simulated") return <span className="text-[10px] font-medium uppercase tracking-wide text-ink-3">simulated</span>;
  const I = s === "sent" ? Check : CheckCheck;
  return <I className={cn("size-3.5", s === "read" ? "text-accent" : "text-ink-3")} aria-label={s} />;
}

function Thread({ c, now, extra, closed, readOnlyRole, onBack, onSent, context }: {
  c: InboxConv; now: string; extra: Msg[]; closed: boolean; readOnlyRole: boolean; onBack: () => void; onSent: (m: Msg) => void; context: React.ReactNode;
}) {
  const ib = useVocab().ib;
  const msgs = [...c.messages, ...extra];
  const end = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => { end.current?.scrollIntoView({ block: "end", behavior: "auto" }); }, [msgs.length]);
  const windowClosed = c.channel === "whatsapp" && (c.windowLeftH ?? 0) <= 0;
  let lastDay = "";

  return (
    <>
      <header className="flex items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
        <button onClick={onBack} className="grid size-11 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-paper-2 md:hidden" aria-label="Back to conversations"><ArrowLeft className="size-5" /></button>
        <Avatar name={c.lead.name} size={32} className="hidden sm:inline-grid" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Link href={`/leads/${c.lead.id}`} className="truncate text-[14px] font-semibold text-ink hover:text-accent">{c.lead.name}</Link>
            <ScoreChip score={c.lead.score} />
          </div>
          <div className="truncate text-[12px] text-ink-3">{c.lead.title}{c.firm && <> · <Link href={`/accounts/${c.firm.id}`} className="hover:text-accent">{c.firm.name}</Link></>} · {c.subject}</div>
        </div>
        <Link href={`/integrations/${CH_INTEGRATION[c.channel]}`} className="hidden shrink-0 items-center gap-1.5 rounded-full border border-line-strong py-0.5 pl-0.5 pr-2.5 text-[12px] text-ink-2 hover:bg-paper-2 sm:inline-flex" title={`${CH_LABEL[c.channel]} connector (Showcase)`}>
          <ChannelMark channel={c.channel} />{CH_LABEL[c.channel]}
        </Link>
        <div className="xl:hidden">
          <Dialog>
            <DialogTrigger asChild><Button size="sm" variant="ghost" aria-label="Lead details"><Info /><span className="hidden sm:inline">Details</span></Button></DialogTrigger>
            <DialogContent title={c.lead.name} description={c.firm?.name} className="max-sm:top-auto max-sm:bottom-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:w-full max-sm:max-w-none max-sm:left-0 max-sm:translate-x-0 max-h-[85dvh] overflow-y-auto">
              <div className="-mx-5 -mb-5">{context}</div>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-paper/50 px-3 py-4 sm:px-5" aria-live="polite">
        <ol className="space-y-2.5">
          {msgs.map((m) => {
            const day = dayKey(m.at); const showDay = day !== lastDay; lastDay = day;
            const us = m.from !== "lead";
            return (
              <li key={m.id}>
                {showDay && <div className="my-3 text-center text-[11px] font-medium text-ink-3">{fmtDate(m.at)}</div>}
                <motion.div initial={reduce || !m.id.startsWith("local") ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}
                  className={cn("flex", us ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[min(520px,86%)] rounded-md px-3 py-2 text-[13px] leading-5 shadow-1",
                    m.from === "note" ? "border border-dashed border-warn/50 bg-warn-soft text-ink" : us ? "bg-navy-900 text-navy-ink" : "border border-line bg-surface text-ink")}>
                    {m.from === "note" && <div className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-warn-ink"><NotebookPen className="size-3" aria-hidden />Internal note · not sent</div>}
                    {m.template && <div className="mb-1 text-[11px] font-medium text-navy-ink-3">Template · {m.template}</div>}
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <div className={cn("mt-1 flex items-center justify-end gap-1.5 text-[11px] num", us && m.from !== "note" ? "text-navy-ink-3" : "text-ink-3")}>
                      <span>{m.author} · {fmtTime(m.at)}</span>{m.from === "us" && <Ticks s={m.status} />}
                    </div>
                  </div>
                </motion.div>
              </li>
            );
          })}
        </ol>
        <div ref={end} />
      </div>

      {readOnlyRole ? (
        <p className="flex items-center gap-2 border-t border-line px-4 py-3 text-[12px] text-ink-3"><Lock className="size-3.5" aria-hidden />{ib.readOnly}</p>
      ) : closed ? (
        <p className="border-t border-line px-4 py-3 text-[12px] text-ink-3">Conversation closed. It reopens on the next inbound message.</p>
      ) : (
        <Composer c={c} windowClosed={windowClosed} onSent={onSent} now={now} />
      )}
    </>
  );
}

function Composer({ c, windowClosed, onSent, now }: { c: InboxConv; windowClosed: boolean; onSent: (m: Msg) => void; now: string }) {
  const vv = useVocab(), ib = vv.ib;
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [fromDraft, setFromDraft] = useState<null | { lang: "en" | "ta"; original: string }>(null);
  const [checked, setChecked] = useState(false);
  const [lang, setLang] = useState<"en" | "ta">("en");
  const [showDraft, setShowDraft] = useState(true);
  const templates = c.channel === "whatsapp" ? (vv.waQuick.length ? vv.waQuick : vv.wa) : c.channel === "email" ? ib.emailTpl : [];
  const [tpl, setTpl] = useState(templates[0]?.id ?? "");
  const [pending, start] = useTransition();
  const reduce = useReducedMotion();
  const tplBody = (id: string) => (templates.find((t) => t.id === id)?.body ?? "").replace("{{1}}", c.lead.first).replace("{{2}}", c.firm?.name ?? ib.yourFirm);
  const draftText = lang === "ta" && c.draft.ta ? c.draft.ta : c.draft.en;
  const templateOnly = windowClosed && mode === "reply";
  const needsCheck = !!fromDraft && mode === "reply";

  const submit = (kind: "reply" | "template" | "note", body: string, templateId?: string) => start(async () => {
    const r = await sendMessage({ convId: c.id, kind, body, templateId, fromDraft: !!fromDraft && kind === "reply", edited: !!fromDraft && body.trim() !== fromDraft.original.trim(), lang: fromDraft?.lang, reviewed: checked });
    toast(r.message, r.sub);
    if (!r.ok) return;
    onSent({ id: `local-${Date.now()}`, from: kind === "note" ? "note" : "us", at: now, body, author: "You", status: kind === "note" ? undefined : "simulated", template: templateId });
    setText(""); setFromDraft(null); setChecked(false); if (kind === "reply" && fromDraft) setShowDraft(false);
  });

  if (!c.reply.ok) return <p className="flex items-center gap-2 border-t border-line px-4 py-3 text-[12px] text-ink-3"><Lock className="size-3.5" aria-hidden />{c.reply.reason}</p>;

  return (
    <div className="border-t border-line bg-surface">
      <AnimatePresence initial={false}>
        {showDraft && mode === "reply" && (
          <motion.div initial={reduce ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={reduce ? undefined : { height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className="overflow-hidden">
            <div className="m-3 mb-0 rounded-md border border-accent/30 bg-accent-soft/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[13px] font-semibold text-ink">Suggested reply — review before sending</h3>
                <Badge tone="accent">AI draft</Badge>
                {lang === "ta" && <Badge tone="warn">Check translation</Badge>}
                <div className="ml-auto flex items-center gap-1">
                  {c.draft.ta && <Segmented label="Draft language" value={lang} onChange={setLang} options={[{ value: "en", label: "English" }, { value: "ta", label: "தமிழ்" }]} />}
                  <button onClick={() => setShowDraft(false)} className="grid size-8 place-items-center rounded-sm text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label="Dismiss draft"><X className="size-4" /></button>
                </div>
              </div>
              {windowClosed ? (
                <p className="mt-2 text-[13px] text-ink-2">The 24-hour window has closed, so free text cannot be sent. Suggested template: <strong className="font-medium text-ink">{ib.suggestTpl(c.lead.stage)}</strong>.</p>
              ) : (
                <>
                  <p lang={lang === "ta" ? "ta" : "en"} className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-[13px] leading-5 text-ink">{draftText}</p>
                  {c.draft.needsReview && <p className="mt-2 flex items-start gap-1.5 rounded-sm bg-warn-soft px-2 py-1.5 text-[12px] text-warn-ink"><CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />{c.draft.needsReview}</p>}
                  <details className="mt-2 text-[12px] text-ink-2">
                    <summary className="cursor-pointer select-none text-ink-3 hover:text-ink">Why this draft · {c.draft.basedOn}</summary>
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-5">{c.draft.rationale.map((r) => <li key={r}>{r}</li>)}</ul>
                    <p className="mt-1.5 text-ink-3">{ib.modelNote}</p>
                  </details>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" onClick={() => { setText(draftText); setFromDraft({ lang, original: draftText }); setChecked(false); }}>Use draft in reply</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setShowDraft(false); toast("Draft dismissed", "Logged as dismissed. Demo: not saved."); }}>Dismiss</Button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="p-3">
        <div className="mb-2 flex items-center gap-2">
          <Segmented label="Composer mode" value={mode} onChange={setMode} options={[{ value: "reply", label: "Reply" }, { value: "note", label: "Internal note" }]} />
          {!showDraft && mode === "reply" && !windowClosed && <Button size="sm" variant="ghost" onClick={() => setShowDraft(true)}>Show suggested reply</Button>}
        </div>
        {templateOnly ? (
          <TemplateRow templates={templates} tpl={tpl} setTpl={setTpl} preview={tplBody(tpl)} pending={pending} consent={c.lead.consent.whatsapp}
            onSend={() => submit("template", tplBody(tpl), tpl)} note="Outside the 24-hour WhatsApp window only approved templates can be sent." />
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); submit(mode, text); }} className="space-y-2">
            <label className="sr-only" htmlFor={`compose-${c.id}`}>{mode === "note" ? "Internal note" : "Reply"}</label>
            <textarea id={`compose-${c.id}`} value={text} onChange={(e) => setText(e.target.value)} rows={3}
              placeholder={mode === "note" ? "Note for your team (not sent to the contact)" : `Reply to ${c.lead.first} on ${CH_LABEL[c.channel]}`}
              className={cn(field, "min-h-[72px] resize-y py-2", mode === "note" && "bg-warn-soft/40")} />
            {needsCheck && (
              <label className="flex items-start gap-2 text-[12px] text-ink-2">
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
                {ib.ack(fromDraft?.lang === "ta")}
              </label>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {templates.length > 0 && mode === "reply" && (
                <label className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-3">
                  <span className="shrink-0">Template</span>
                  <select value="" onChange={(e) => { if (e.target.value) { setText(tplBody(e.target.value)); setTpl(e.target.value); setFromDraft(null); } }} className={cn(field, "h-8 max-w-[200px] text-[12px]")}>
                    <option value="">Insert…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.id} ({t.lang})</option>)}
                  </select>
                </label>
              )}
              <Button type="submit" size="sm" variant={mode === "note" ? "secondary" : "primary"} className="ml-auto" disabled={pending || !text.trim() || (needsCheck && !checked)}>
                {mode === "note" ? <><NotebookPen />Add note</> : <><Send />{fromDraft ? "Approve and send" : "Send"} (simulated)</>}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function TemplateRow({ templates, tpl, setTpl, preview, pending, onSend, note, consent }: {
  templates: { id: string; lang: string }[]; tpl: string; setTpl: (v: string) => void; preview: string; pending: boolean; onSend: () => void; note: string; consent: boolean;
}) {
  if (!consent) return <p className="rounded-sm bg-warn-soft px-3 py-2 text-[12px] text-warn-ink">No WhatsApp consent on file. Record consent before sending a template.</p>;
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-[12px] text-ink-3"><Lock className="size-3.5" aria-hidden />{note}</p>
      <select value={tpl} onChange={(e) => setTpl(e.target.value)} className={cn(field, "h-9")} aria-label="Approved template">
        {templates.map((t) => <option key={t.id} value={t.id}>{t.id} ({t.lang})</option>)}
      </select>
      <p className="rounded-sm border border-line bg-paper px-3 py-2 text-[13px] leading-5 text-ink-2">{preview}</p>
      <div className="flex justify-end"><Button size="sm" variant="primary" onClick={onSend} disabled={pending}><Send />Send template (simulated)</Button></div>
    </div>
  );
}

function ContextPanel({ c, linkable, reps, assign, onClosed }: { c: InboxConv; linkable: { id: string; label: string }[]; reps: { id: string; name: string }[]; assign: Verdict; onClosed: () => void }) {
  const ib = useVocab().ib;
  const [pending, start] = useTransition();
  const [link, setLink] = useState(c.lead.id);
  const [who, setWho] = useState(c.lead.ownerId);
  const run = (p: Promise<{ ok: boolean; message: string; sub?: string }>, after?: () => void) => start(async () => { const r = await p; toast(r.message, r.sub); if (r.ok) after?.(); });
  const opts = useMemo(() => (linkable.some((l) => l.id === c.lead.id) ? linkable : [{ id: c.lead.id, label: c.lead.name }, ...linkable]), [linkable, c.lead]);
  const consent = [[ib.followUp, c.lead.consent.followup], ["WhatsApp", c.lead.consent.whatsapp], ["Marketing email", c.lead.consent.marketing]] as const;
  return (
    <div className="divide-y divide-line text-[13px]">
      <div className="p-4">
        <div className="eyebrow mb-2">{ib.leadEyebrow}</div>
        <Link href={`/leads/${c.lead.id}`} className="font-semibold text-ink hover:text-accent">{c.lead.name}</Link>
        <div className="text-[12px] text-ink-3">{c.lead.title}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5"><Badge tone="neutral">{c.lead.stage}</Badge><ScoreChip score={c.lead.score} /></div>
        {c.firm && <div className="mt-2 text-[12px] text-ink-2"><Link href={`/accounts/${c.firm.id}`} className="font-medium hover:text-accent">{c.firm.name}</Link>{ib.firmMeta(c.firm.district, c.firm.lawyers)}</div>}
        <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
          <a href={`tel:${c.lead.phone.replace(/[^\d+]/g, "")}`} className="text-accent hover:underline num">{c.lead.phone}</a>
        </div>
      </div>
      <div className="p-4">
        <div className="eyebrow mb-2">{ib.dealEyebrow}</div>
        {c.deal ? <div><div className="font-medium">{ib.dealLine(c.deal.plan, c.deal.seats)}</div><div className="text-[12px] text-ink-3 num">{c.deal.stage} · {inrCompact(c.deal.value)}</div></div>
          : <p className="text-[12px] text-ink-3">{ib.noDeal}</p>}
      </div>
      <div className="p-4">
        <div className="eyebrow mb-2">Consent</div>
        <ul className="space-y-1">{consent.map(([k, v]) => (
          <li key={k} className="flex items-center justify-between text-[12px]"><span className="text-ink-2">{k}</span>{v ? <span className="inline-flex items-center gap-1 text-success"><Check className="size-3.5" aria-hidden />Granted</span> : <span className="inline-flex items-center gap-1 text-ink-3"><XCircle className="size-3.5" aria-hidden />Not given</span>}</li>
        ))}</ul>
      </div>
      <div className="space-y-3 p-4">
        <div className="eyebrow">Actions</div>
        <div>
          <label className="mb-1 flex items-center gap-1 text-[12px] font-medium text-ink-2" htmlFor={`link-${c.id}`}><Link2 className="size-3.5" aria-hidden />{ib.linked}</label>
          <div className="flex gap-2">
            <select id={`link-${c.id}`} value={link} onChange={(e) => setLink(e.target.value)} className={cn(field, "h-9 min-w-0 flex-1 text-[12px]")}>
              {opts.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <Gated v={c.reply}><Button size="sm" disabled={pending || link === c.lead.id} onClick={() => run(linkConversation(c.id, link))}>Link</Button></Gated>
          </div>
        </div>
        <div>
          <label className="mb-1 flex items-center gap-1 text-[12px] font-medium text-ink-2" htmlFor={`as-${c.id}`}><UserRoundCog className="size-3.5" aria-hidden />Assigned to</label>
          <div className="flex gap-2">
            <select id={`as-${c.id}`} value={who} onChange={(e) => setWho(e.target.value)} disabled={!assign.ok} className={cn(field, "h-9 min-w-0 flex-1 text-[12px] disabled:opacity-60")}>
              {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <Gated v={assign}><Button size="sm" disabled={pending || who === c.lead.ownerId} onClick={() => run(assignConversation(c.id, who))}>Assign</Button></Gated>
          </div>
        </div>
        <Gated v={c.reply}><Button size="sm" variant="ghost" className="w-full" disabled={pending} onClick={() => run(closeConversation(c.id), onClosed)}>Close conversation</Button></Gated>
        <StatusChip status="showcase" label="Showcase · simulated" />
      </div>
    </div>
  );
}
