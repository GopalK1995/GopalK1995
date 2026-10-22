"use client";
// The seven editors. Each one edits a draft of its slice of the effective config, previews it live, and saves a
// patch of that slice only. Wording, Stages, Categories, Modules, Dashboard, Branding and fonts, Data and import.
import { useEffect, useMemo, type CSSProperties } from "react";
import { ArrowDown, ArrowUp, Check, Download, Info, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { csvColumns, csvTemplate, CSV_FILE } from "@/lib/config/csv";
import { FONT_LABEL, FONT_STACKS } from "@/lib/config/fonts";
import {
  CHANNEL_FAMILY_IDS, CHART_CATALOGUE, FIRM_SIZE_IDS, FONT_KEYS, FUNNEL_IDS, IMPORT_KINDS, MODULE_IDS, STAGE_COLORS, TILE_CATALOGUE, VIEW_IDS,
  validateEffective, stageList, type FontKey, type ImportKind, type ModuleId, type StageCfg, type StageColor, type StageKind, type TenantConfig,
} from "@/lib/config/types";
import { contrastChecks } from "./contrast";
import { Field, ListEditor, SaveBar, SectionLayout, Toggle, inputCls, lockedWhy, selectCls, useCfg, useSection } from "./config-shared";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const Note = ({ children }: { children: React.ReactNode }) => (
  <p className="flex items-start gap-2 rounded-sm border border-line bg-surface px-3 py-2 text-[12px] leading-[18px] text-ink-2"><Info className="mt-px size-4 shrink-0 text-ink-3" aria-hidden /><span>{children}</span></p>
);
const Issues = ({ list }: { list: string[] }) => (list.length ? <ul className="mt-3 flex flex-col gap-1 text-[12px] text-danger" aria-live="polite">{list.map((m) => <li key={m}>{m}</li>)}</ul> : null);
const tone = (c: StageColor) => (c === "info" ? "accent" : c) as "neutral" | "accent" | "warn" | "success" | "danger";

// ------------------------------------------------------------------------------------------------ wording
export function WordingSection() {
  const { access } = useCfg(); const a = access.vocabulary, ed = a === "edit";
  const s = useSection((c) => c.vocabulary, (d) => ({ vocabulary: d }), ["vocabulary"]);
  const d = s.draft;
  const set = (f: (x: typeof d) => void) => s.setDraft((p) => { const x = structuredClone(p); f(x); return x; });
  const nouns: [keyof typeof d.n, string][] = [["lead", "Lead"], ["deal", "Deal"], ["demo", "Demo or visit"], ["firm", "Account"]];
  return (
    <SectionLayout title="Wording" sub="The names your team sees across every page" note={ed ? undefined : <Note>{lockedWhy(a)}</Note>}
      preview={<div className="flex flex-col gap-4 text-[13px]">
        <div className="rounded-sm border border-line bg-navy-900 p-3">{[d.nav.leads, d.nav.accounts, d.nav.sell].map((l) => <div key={l} className="h-7 truncate px-2 text-[12px] leading-7 text-navy-ink-2">{l}</div>)}</div>
        <ul className="flex flex-col gap-1 text-ink-2"><li>12 {d.n.lead.many} this month</li><li>1 {d.n.lead.one} waiting for a reply</li><li>5 {d.n.deal.many} in progress</li><li>2 {d.n.demo.many} scheduled</li><li>New {d.n.firm.one} added</li></ul>
        <div className="rounded-sm border border-line px-3 py-2 text-ink-3">{d.search}</div>
      </div>}>
      <fieldset disabled={!ed} className="flex flex-col gap-5 disabled:opacity-100">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {nouns.map(([k, label]) => (
            <div key={k} className="grid grid-cols-2 gap-2">
              <Field label={`${label}, singular`}><input value={d.n[k].one} maxLength={32} onChange={(e) => set((x) => { x.n[k].one = e.target.value; })} className={inputCls} /></Field>
              <Field label={`${label}, plural`}><input value={d.n[k].many} maxLength={32} onChange={(e) => set((x) => { x.n[k].many = e.target.value; })} className={inputCls} /></Field>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(["leads", "accounts", "sell"] as const).map((k) => <Field key={k} label={`Menu: ${k === "sell" ? "Sell group" : k === "leads" ? "Leads page" : "Accounts page"}`}><input value={d.nav[k]} maxLength={32} onChange={(e) => set((x) => { x.nav[k] = e.target.value; })} className={inputCls} /></Field>)}
        </div>
        <Field label="Search placeholder"><input value={d.search} maxLength={80} onChange={(e) => set((x) => { x.search = e.target.value; })} className={inputCls} /></Field>
        <div><div className="eyebrow mb-2">Funnel steps</div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FUNNEL_IDS.map((k) => <Field key={k} label={cap(k.replace("_", " "))}><input value={d.funnel[k] ?? ""} maxLength={40} onChange={(e) => set((x) => { x.funnel[k] = e.target.value; })} className={inputCls} /></Field>)}
        </div></div>
        <div><div className="eyebrow mb-2">List views</div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {VIEW_IDS.map((k) => <Field key={k} label={cap(k)}><input value={d.views[k] ?? ""} maxLength={32} onChange={(e) => set((x) => { x.views[k] = e.target.value; })} className={inputCls} /></Field>)}
        </div></div>
      </fieldset>
      <SaveBar s={s} editable={ed} why={lockedWhy(a)} />
    </SectionLayout>
  );
}

// ------------------------------------------------------------------------------------------------ stages
function StageList({ kind, stages, onChange, ed, vocab }: { kind: StageKind; stages: Record<string, StageCfg>; onChange: (s: Record<string, StageCfg>) => void; ed: boolean; vocab: string }) {
  const ids = stageList(stages);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= ids.length) return;
    const order = [...ids]; [order[i], order[j]] = [order[j], order[i]];
    onChange(Object.fromEntries(order.map((id, n) => [id, { ...stages[id], order: n }])));
  };
  const patch = (id: string, p: Partial<StageCfg>) => onChange({ ...stages, [id]: { ...stages[id], ...p } });
  return (
    <section aria-labelledby={`st-${kind}`}>
      <h3 id={`st-${kind}`} className="eyebrow mb-2">{vocab} stages</h3>
      <ol className="rounded-sm border border-line">
        {ids.map((id, i) => {
          const s = stages[id], fixed = id === "won" || id === "lost";
          return (
            <li key={id} className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-line px-3 py-2 last:border-b-0">
              <span className="w-4 text-right text-[12px] text-ink-3 num">{i + 1}</span>
              <input aria-label={`${vocab} stage ${id} name`} value={s.label} maxLength={32} disabled={!ed} onChange={(e) => patch(id, { label: e.target.value })} className={cn(inputCls, "min-w-0 flex-1 basis-36")} />
              <label className="flex items-center gap-1 text-[12px] text-ink-3"><input aria-label={`${s.label} probability percent`} type="number" min={0} max={100} value={s.probability} disabled={!ed || s.outcome !== "open"} onChange={(e) => patch(id, { probability: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} className={cn(inputCls, "w-16 text-right num")} />%</label>
              <select aria-label={`${s.label} colour`} value={s.color} disabled={!ed} onChange={(e) => patch(id, { color: e.target.value as StageColor })} className={cn(selectCls, "w-24")}>{STAGE_COLORS.map((c) => <option key={c} value={c}>{cap(c)}</option>)}</select>
              <select aria-label={`${s.label} counts as`} value={s.outcome} disabled={!ed || fixed} onChange={(e) => { const o = e.target.value as StageCfg["outcome"]; patch(id, { outcome: o, probability: o === "won" ? 100 : o === "lost" ? 0 : Math.min(s.probability, 99) }); }} className={cn(selectCls, "w-24")}>
                <option value="open">Open</option><option value="won">Counts as won</option><option value="lost">Counts as lost</option>
              </select>
              <span className="ml-auto flex">
                <Button size="icon" variant="ghost" aria-label={`Move ${s.label} up`} disabled={!ed || i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                <Button size="icon" variant="ghost" aria-label={`Move ${s.label} down`} disabled={!ed || i === ids.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
export function StagesSection() {
  const { access, base } = useCfg(); const a = access.stages, ed = a === "edit";
  const s = useSection((c) => c.stages, (d) => ({ stages: d }), ["stages"]);
  const issues = useMemo(() => validateEffective({ ...base, stages: s.draft }).filter((i) => i.path.startsWith("stages")).map((i) => i.message), [base, s.draft]);
  const n = base.vocabulary.n;
  return (
    <SectionLayout title="Stages" sub="Names, order, win probability and colour. The internal stage ids stay fixed so reports keep working." note={ed ? undefined : <Note>{lockedWhy(a)}</Note>}
      preview={<div className="flex flex-col gap-4">
        {(["lead", "deal"] as const).map((k) => <div key={k}><div className="eyebrow mb-2">{cap(k === "lead" ? n.lead.one : n.deal.one)} journey</div>
          <ol className="flex flex-wrap gap-1.5">{stageList(s.draft[k] as Record<string, StageCfg>).map((id) => { const st = (s.draft[k] as Record<string, StageCfg>)[id]; return <li key={id}><Badge tone={tone(st.color)}>{st.label}{st.outcome === "open" ? ` ${st.probability}%` : ""}</Badge></li>; })}</ol></div>)}
        <p className="text-[12px] text-ink-3">The pipeline board, funnel and weighted forecast use this order and these probabilities.</p>
      </div>}>
      <div className="flex flex-col gap-5">
        <StageList kind="lead" vocab={cap(n.lead.one)} ed={ed} stages={s.draft.lead as Record<string, StageCfg>} onChange={(x) => s.setDraft((p) => ({ ...p, lead: x as typeof p.lead }))} />
        <StageList kind="deal" vocab={cap(n.deal.one)} ed={ed} stages={s.draft.deal as Record<string, StageCfg>} onChange={(x) => s.setDraft((p) => ({ ...p, deal: x as typeof p.deal }))} />
      </div>
      <Issues list={issues} />
      <SaveBar s={{ ...s, save: issues.length ? () => s.setError(issues[0]) : s.save }} editable={ed} why={lockedWhy(a)} />
    </SectionLayout>
  );
}

// ------------------------------------------------------------------------------------------------ categories
export function CategoriesSection() {
  const { access, base } = useCfg(); const a = access.taxonomies, ed = a === "edit";
  const s = useSection((c) => c.taxonomies, (d) => ({ taxonomies: d }), ["taxonomies"]);
  const d = s.draft;
  const set = (f: (x: typeof d) => void) => s.setDraft((p) => { const x = structuredClone(p); f(x); return x; });
  const slug = (label: string, used: string[]) => { const b = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28) || "reason"; let id = /^[a-z]/.test(b) ? b : `r_${b}`; while (used.includes(id)) id += "_x"; return id.slice(0, 32); };
  return (
    <SectionLayout title="Categories" sub="Size buckets, channel names, lost reasons and the lists people pick from" note={ed ? undefined : <Note>{lockedWhy(a)}</Note>}
      preview={<div className="flex flex-col gap-3 text-[12px] text-ink-2">
        <div><div className="eyebrow mb-1">Size</div>{Object.values(d.partySize).join(" · ")}</div>
        <div><div className="eyebrow mb-1">Channels</div>{Object.values(d.channelFamily).join(" · ")}</div>
        <div><div className="eyebrow mb-1">Lost reasons</div>{d.lost.map((r) => r[1]).join(" · ")}</div>
        <div><div className="eyebrow mb-1">Rooms or products</div>{d.plans.filter(Boolean).join(" · ") || "None"}</div>
        <div><div className="eyebrow mb-1">Categories</div>{d.interests.filter(Boolean).join(" · ") || "None"}</div>
      </div>}>
      <fieldset disabled={!ed} className="flex flex-col gap-5 disabled:opacity-100">
        <div><div className="eyebrow mb-2">Size buckets (the buckets themselves are fixed; rename them)</div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {FIRM_SIZE_IDS.map((k) => <Field key={k} label={`Bucket ${k}`}><input value={d.partySize[k]} maxLength={32} onChange={(e) => set((x) => { x.partySize[k] = e.target.value; })} className={inputCls} /></Field>)}
        </div></div>
        <div><div className="eyebrow mb-2">Channel names</div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CHANNEL_FAMILY_IDS.map((k) => <Field key={k} label={k}><input value={d.channelFamily[k] ?? ""} maxLength={32} onChange={(e) => set((x) => { x.channelFamily[k] = e.target.value; })} className={inputCls} /></Field>)}
        </div></div>
        <div><div className="eyebrow mb-2">Lost reasons</div>
          <div className="flex flex-col gap-2">
            {d.lost.map(([id, label], i) => (
              <div key={id} className="flex items-center gap-2">
                <input aria-label={`Lost reason ${i + 1}`} value={label} maxLength={40} onChange={(e) => set((x) => { x.lost[i][1] = e.target.value; })} className={cn(inputCls, "min-w-0 flex-1")} />
                <Button size="sm" variant="ghost" disabled={d.lost.length <= 1} aria-label={`Remove ${label}`} onClick={() => set((x) => { x.lost.splice(i, 1); })}>Remove</Button>
              </div>
            ))}
            <div><Button size="sm" disabled={d.lost.length >= 12} onClick={() => set((x) => { x.lost.push([slug(`reason ${x.lost.length + 1}`, x.lost.map((r) => r[0])), `Reason ${x.lost.length + 1}`]); })}>Add reason</Button><span className="ml-2 text-[12px] text-ink-3">{d.lost.length} of 12</span></div>
          </div>
        </div>
        <div><div className="eyebrow mb-2">Rooms or products ({base.vocabulary.n.deal.one} form)</div><ListEditor items={d.plans} onChange={(x) => set((y) => { y.plans = x; })} max={20} label="Room or product" disabled={!ed} /></div>
        <div><div className="eyebrow mb-2">Categories (trip types or practice areas)</div><ListEditor items={d.interests} onChange={(x) => set((y) => { y.interests = x; })} max={20} label="Category" disabled={!ed} /></div>
      </fieldset>
      <SaveBar s={s} editable={ed} why={lockedWhy(a)} />
    </SectionLayout>
  );
}

// ------------------------------------------------------------------------------------------------ modules
const MODULE_LABEL: Record<ModuleId, [string, string]> = {
  inbox: ["Inbox", "WhatsApp and email conversations"], ai: ["Copilot", "Questions about your own numbers"], integrations: ["Integrations", "Connections to channels and tools"],
  audience: ["Audience", "Segments and who responds"], analytics: ["Web analytics", "Site traffic and attribution"], tasks: ["Tasks", "Follow-ups and reminders"],
  accounts: ["Accounts", "Organisations and repeat customers"], campaigns: ["Campaigns", "Spend, reach and cost per result"], "data-health": ["Data health", "Sync status and backups"],
};
export function ModulesSection() {
  const { access, scope, moduleLocks } = useCfg(); const a = access.modules, ed = a === "edit";
  const s = useSection((c) => ({ modules: c.modules, features: c.features, modulesLocked: c.modulesLocked }), (d) => ({ modules: d.modules, ...(scope === "platform" ? { features: d.features, modulesLocked: d.modulesLocked } : {}) }), ["modules", ...(scope === "platform" ? (["features", "modulesLocked"] as const) : [])]);
  const d = s.draft, fa = access.verticalFeatures, la = access.modulesLock;
  return (
    <SectionLayout title="Modules" sub="Switch off what you do not use. A switched-off module disappears from the menu and its pages are blocked." note={ed ? undefined : <Note>{lockedWhy(a)}</Note>}
      preview={<div className="rounded-sm border border-line bg-navy-900 p-3">{MODULE_IDS.map((m) => <div key={m} className={cn("h-7 truncate px-2 text-[12px] leading-7", d.modules[m] ? "text-navy-ink" : "text-navy-ink-3 line-through")}>{MODULE_LABEL[m][0]}</div>)}</div>}>
      <ul className="rounded-sm border border-line">
        {MODULE_IDS.map((m) => {
          const lock = moduleLocks[m]; const turnOnBlocked = scope === "org" && !d.modules[m] && !!lock;
          const off = !ed || (scope === "org" && (d.modulesLocked.includes(m) || turnOnBlocked));
          return (
            <li key={m} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1"><div className="text-[13px] font-medium text-ink">{MODULE_LABEL[m][0]}{d.modulesLocked.includes(m) && <Badge tone="outline" className="ml-2">Locked</Badge>}</div><div className="text-[12px] text-ink-3">{scope === "org" && lock ? lock : MODULE_LABEL[m][1]}</div></div>
              {scope === "platform" && <label className="flex items-center gap-1.5 text-[12px] text-ink-3"><input type="checkbox" checked={d.modulesLocked.includes(m)} disabled={!ed || la !== "edit"} onChange={(e) => s.setDraft((p) => ({ ...p, modulesLocked: e.target.checked ? [...p.modulesLocked, m] : p.modulesLocked.filter((x) => x !== m) }))} />Lock</label>}
              <Toggle checked={d.modules[m]} disabled={off} label={`${MODULE_LABEL[m][0]} module`} onChange={(v) => s.setDraft((p) => ({ ...p, modules: { ...p.modules, [m]: v } }))} />
            </li>
          );
        })}
      </ul>
      <div className="mt-4"><div className="eyebrow mb-2">Vertical-only features</div>
        <ul className="rounded-sm border border-line">
          {([["ecourts", "eCourts lookups", "Court case status and hearing dates (legal)"], ["hearings", "Hearings calendar", "Hearing dates on leads and accounts (legal)"]] as const).map(([k, label, hint]) => (
            <li key={k} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1"><div className="text-[13px] font-medium text-ink">{label}</div><div className="text-[12px] text-ink-3">{scope === "platform" ? hint : "Only the platform operator can change this."}</div></div>
              <Toggle checked={d.features[k]} disabled={!ed || scope !== "platform" || fa !== "edit"} label={label} onChange={(v) => s.setDraft((p) => ({ ...p, features: { ...p.features, [k]: v } }))} />
            </li>
          ))}
        </ul>
      </div>
      <SaveBar s={s} editable={ed} why={lockedWhy(a)} />
    </SectionLayout>
  );
}

// ------------------------------------------------------------------------------------------------ dashboard
export function DashboardSection() {
  const { access, scope, base } = useCfg(); const a = access.dashboard, ed = a === "edit", ca = access.tileCatalogue;
  const s = useSection((c) => c.dashboard, (d) => ({ dashboard: scope === "platform" ? d : { kpiTiles: d.kpiTiles, charts: d.charts } }), ["dashboard"]);
  const d = s.draft;
  const allowed = TILE_CATALOGUE.filter((t) => t.base || d.catalogueExtra.includes(t.id));
  const tileLabel = (id: string) => TILE_CATALOGUE.find((t) => t.id === id)?.label ?? id;
  const issues = validateEffective({ ...base, dashboard: d }).filter((i) => i.path.startsWith("dashboard")).map((i) => i.message);
  if (new Set(d.kpiTiles).size !== d.kpiTiles.length) issues.push("Each headline tile can appear once.");
  return (
    <SectionLayout title="Dashboard" sub="The four headline tiles and the charts on the Command Center" note={ed ? undefined : <Note>{lockedWhy(a)}</Note>}
      preview={<div className="flex flex-col gap-3"><div className="grid grid-cols-2 gap-2">{d.kpiTiles.map((id, i) => <div key={i} className="rounded-sm border border-line px-3 py-2"><div className="truncate text-[11px] text-ink-3">{tileLabel(id)}</div><div className="mt-1 text-[18px] font-semibold text-ink num">{["₹4.2L", "38", "21%", "₹1,950"][i]}</div></div>)}</div>
        <div className="text-[12px] text-ink-2">{CHART_CATALOGUE.filter((c) => d.charts.includes(c.id)).map((c) => c.label).join(" · ") || "No charts"}</div></div>}>
      <fieldset disabled={!ed} className="flex flex-col gap-5 disabled:opacity-100">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {d.kpiTiles.map((id, i) => <Field key={i} label={`Headline tile ${i + 1}`}><select value={id} onChange={(e) => s.setDraft((p) => ({ ...p, kpiTiles: p.kpiTiles.map((x, j) => (j === i ? e.target.value : x)) }))} className={cn(selectCls, "w-full")}>{allowed.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>)}
        </div>
        <div><div className="eyebrow mb-2">Charts</div><div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {CHART_CATALOGUE.map((c) => <label key={c.id} className="flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" checked={d.charts.includes(c.id)} onChange={(e) => s.setDraft((p) => ({ ...p, charts: e.target.checked ? [...p.charts, c.id] : p.charts.filter((x) => x !== c.id) }))} />{c.label}</label>)}
        </div></div>
        <div><div className="eyebrow mb-2">Tile catalogue {scope === "org" && <span className="font-normal normal-case tracking-normal text-ink-3">(extended by the platform operator)</span>}</div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {TILE_CATALOGUE.map((t) => <label key={t.id} className="flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" checked={t.base || d.catalogueExtra.includes(t.id)} disabled={t.base || scope !== "platform" || ca !== "edit" || !ed} onChange={(e) => s.setDraft((p) => ({ ...p, catalogueExtra: e.target.checked ? [...p.catalogueExtra, t.id] : p.catalogueExtra.filter((x) => x !== t.id), kpiTiles: e.target.checked ? p.kpiTiles : p.kpiTiles }))} />{t.label}{!t.base && <Badge tone="outline">Extended</Badge>}</label>)}
          </div>
        </div>
      </fieldset>
      <Issues list={issues} />
      <SaveBar s={{ ...s, save: issues.length ? () => s.setError(issues[0]) : s.save }} editable={ed} why={lockedWhy(a)} />
    </SectionLayout>
  );
}

// ------------------------------------------------------------------------------------------------ branding & fonts
const previewVars = (h: number) => ({ "--accent": `oklch(0.52 0.15 ${h})`, "--accent-ink": `oklch(0.99 0.005 ${h})`, "--navy-900": `oklch(0.22 0.045 ${h})`, "--navy-ink": `oklch(0.96 0.01 ${h})` }) as CSSProperties;
export function BrandingSection() {
  const { access, base } = useCfg(); const a = access.branding, ed = a === "edit";
  const s = useSection((c) => c.branding, (d) => ({ branding: d }), ["branding"]);
  const d = s.draft;
  const checks = useMemo(() => contrastChecks(d.hue), [d.hue]);
  const passes = checks.every((c) => c.value >= c.min);
  useEffect(() => { document.documentElement.style.setProperty("--brand-h", String(d.hue)); return () => { document.documentElement.style.setProperty("--brand-h", String(base.branding.hue)); }; }, [d.hue, base.branding.hue]);
  const fontSelect = (which: "heading" | "body", label: string) => (
    <Field label={label}><select value={d.fonts[which]} onChange={(e) => s.setDraft((p) => ({ ...p, fonts: { ...p.fonts, [which]: e.target.value as FontKey } }))} className={cn(selectCls, "w-full")}>{FONT_KEYS.map((k) => <option key={k} value={k}>{FONT_LABEL[k]}</option>)}</select></Field>
  );
  return (
    <SectionLayout title="Branding and fonts" sub="Name, accent colour and the two fonts used across the app" note={ed ? undefined : <Note>{lockedWhy(a)}</Note>}
      preview={<div style={previewVars(d.hue)} className="overflow-hidden rounded-md border border-line">
        <div className="flex items-center gap-2 bg-navy-900 p-3"><span className="grid size-6 place-items-center rounded-[4px] bg-accent text-[11px] font-semibold text-accent-ink">{d.name.trim()[0]?.toUpperCase()}</span><div className="min-w-0"><div className="truncate text-[12px] font-semibold text-navy-ink">{d.name}</div><div className="truncate text-[11px] text-navy-ink">{d.product}</div></div></div>
        <div className="p-4"><div className="text-[18px] font-semibold leading-6 text-ink" style={{ fontFamily: FONT_STACKS[d.fonts.heading] || "var(--font-ui)" }}>Headings look like this</div>
          <p className="mt-1 text-[13px] leading-5 text-ink-2" style={{ fontFamily: FONT_STACKS[d.fonts.body] || "var(--font-ui)" }}>Body text, tables and forms use the body font. 1,248 enquiries, ₹4,20,000.</p>
          <span className="mt-3 inline-flex h-8 items-center rounded-sm bg-accent px-3 text-[13px] font-medium text-accent-ink">Primary action</span></div>
      </div>}>
      <fieldset disabled={!ed} className="flex flex-col gap-4 disabled:opacity-100">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Brand name"><input value={d.name} maxLength={40} onChange={(e) => s.setDraft((p) => ({ ...p, name: e.target.value }))} className={inputCls} /></Field>
          <Field label="Product name"><input value={d.product} maxLength={40} onChange={(e) => s.setDraft((p) => ({ ...p, product: e.target.value }))} className={inputCls} /></Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{fontSelect("heading", "Heading font")}{fontSelect("body", "Body font")}</div>
        <div>
          <div className="mb-1 flex items-center justify-between"><label htmlFor="cfg-hue" className="text-[12px] font-medium text-ink-2">Accent hue</label><output htmlFor="cfg-hue" className="font-mono text-[12px] text-ink num">{d.hue}°</output></div>
          <input id="cfg-hue" type="range" min={0} max={359} value={d.hue} onChange={(e) => s.setDraft((p) => ({ ...p, hue: Number(e.target.value) }))} className="h-6 w-full cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed" aria-valuetext={`Hue ${d.hue} degrees, ${passes ? "passes" : "fails"} WCAG AA`} />
        </div>
      </fieldset>
      <section aria-labelledby="cfg-contrast" className="mt-4 rounded-sm border border-line bg-paper px-3 py-3">
        <h3 id="cfg-contrast" className="eyebrow mb-2">Contrast check (WCAG AA, 4.5:1)</h3>
        <ul className="flex flex-col gap-1.5" aria-live="polite">{checks.map((c) => { const ok = c.value >= c.min; return (
          <li key={c.key} className="flex items-center justify-between gap-3 text-[12px]"><span className="text-ink-2">{c.label}</span><span className={cn("inline-flex items-center gap-1 font-medium num", ok ? "text-success" : "text-danger")}>{ok ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}{c.value.toFixed(2)}:1 {ok ? "pass" : "fail"}</span></li>); })}</ul>
        {!passes && <p className="mt-2 text-[12px] text-danger">Save is blocked until every pair reaches 4.5:1.</p>}
      </section>
      <SaveBar s={{ ...s, save: passes ? s.save : () => s.setError("Text contrast is below 4.5:1. Pick another hue.") }} editable={ed} why={lockedWhy(a)} resetLabel="Reset to tenant default" />
    </SectionLayout>
  );
}

// ------------------------------------------------------------------------------------------------ data & import
const download = (name: string, text: string) => { const u = URL.createObjectURL(new Blob([text], { type: "text/csv" })); const a = document.createElement("a"); a.href = u; a.download = name; a.click(); URL.revokeObjectURL(u); };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function DataSection() {
  const { access, base, scope } = useCfg(); const ta = access.targets, sa = access.dataSample, ia = access.dataImport;
  const s = useSection((c) => c.data, (d) => ({ data: d }), ["data"]);
  const d = s.draft, n = base.vocabulary.n;
  const ed = ta === "edit" || sa === "edit" || ia === "edit";
  const noSampleOn = scope === "org" && !base.data.sampleData;
  return (
    <SectionLayout title="Data and import" sub="Sample data, response targets, business hours and CSV import templates" note={ed ? undefined : <Note>{lockedWhy(ta)}</Note>}
      preview={<div className="flex flex-col gap-3 text-[12px] text-ink-2"><div><div className="eyebrow mb-1">Reply target</div>First reply within {d.slaHours} {d.slaHours === 1 ? "hour" : "hours"}</div><div><div className="eyebrow mb-1">Business hours</div>{d.businessHours.days.map((x) => DAYS[x]).join(", ")} · {d.businessHours.start} to {d.businessHours.end}</div><div><div className="eyebrow mb-1">Target per rep</div>{d.targetPerRepMonthly === null ? "Not set" : `₹${d.targetPerRepMonthly.toLocaleString("en-IN")} a month`}</div><div><div className="eyebrow mb-1">Sample data</div>{d.sampleData ? "Shown" : "Hidden: only your own records appear"}</div></div>}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded-sm border border-line px-3 py-2.5">
          <div className="min-w-0 flex-1"><div className="text-[13px] font-medium text-ink">Show sample data</div><div className="text-[12px] text-ink-3">{scope === "org" ? "Switch off when you start using your own records. Switching it back on is done by the platform operator." : "On for demo tenants, off for real ones."}</div></div>
          <Toggle checked={d.sampleData} disabled={sa !== "edit" || noSampleOn} label="Show sample data" onChange={(v) => s.setDraft((p) => ({ ...p, sampleData: v }))} />
        </div>
        <fieldset disabled={ta !== "edit"} className="grid grid-cols-1 gap-3 sm:grid-cols-2 disabled:opacity-100">
          <Field label="First-reply target (hours)"><input type="number" min={1} max={72} value={d.slaHours} onChange={(e) => s.setDraft((p) => ({ ...p, slaHours: Math.max(1, Math.min(72, Math.round(Number(e.target.value) || 1))) }))} className={cn(inputCls, "num")} /></Field>
          <Field label="Monthly target per rep (₹)" hint="Leave empty for no target"><input type="number" min={0} value={d.targetPerRepMonthly ?? ""} onChange={(e) => s.setDraft((p) => ({ ...p, targetPerRepMonthly: e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value))) }))} className={cn(inputCls, "num")} /></Field>
          <Field label="Opens"><input type="time" value={d.businessHours.start} onChange={(e) => s.setDraft((p) => ({ ...p, businessHours: { ...p.businessHours, start: e.target.value } }))} className={inputCls} /></Field>
          <Field label="Closes"><input type="time" value={d.businessHours.end} onChange={(e) => s.setDraft((p) => ({ ...p, businessHours: { ...p.businessHours, end: e.target.value } }))} className={inputCls} /></Field>
          <div className="flex flex-wrap gap-2 sm:col-span-2" role="group" aria-label="Open days">{DAYS.map((nm, i) => <label key={nm} className="flex items-center gap-1 text-[12px] text-ink-2"><input type="checkbox" checked={d.businessHours.days.includes(i)} onChange={(e) => s.setDraft((p) => ({ ...p, businessHours: { ...p.businessHours, days: (e.target.checked ? [...p.businessHours.days, i] : p.businessHours.days.filter((x) => x !== i)).sort() } }))} />{nm}</label>)}</div>
        </fieldset>
        <div>
          <div className="eyebrow mb-2">CSV templates</div>
          <div className="flex flex-col gap-3">
            {IMPORT_KINDS.map((k) => <ImportBlock key={k} kind={k} cfg={{ ...base, data: d }} labels={{ leads: cap(n.lead.many), accounts: cap(n.firm.many), campaigns: "Campaigns" }} mapping={d.importMappings[k]} editable={ia === "edit"} onMap={(m) => s.setDraft((p) => ({ ...p, importMappings: { ...p.importMappings, [k]: m } }))} />)}
          </div>
          <p className="mt-2 text-[12px] text-ink-3">Importing uses the existing import dialog on each page; its column mapping reads these names.</p>
        </div>
      </div>
      <SaveBar s={s} editable={ed} why={lockedWhy(ta)} noReset />
    </SectionLayout>
  );
}
function ImportBlock({ kind, cfg, labels, mapping, editable, onMap }: { kind: ImportKind; cfg: TenantConfig; labels: Record<ImportKind, string>; mapping: Record<string, string>; editable: boolean; onMap: (m: Record<string, string>) => void }) {
  const cols = csvColumns(kind, cfg);
  const rows = Object.entries(mapping);
  return (
    <details className="rounded-sm border border-line">
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-[13px] font-medium text-ink">{labels[kind]}<span className="text-[12px] font-normal text-ink-3">{cols.length} columns</span></summary>
      <div className="border-t border-line px-3 py-3">
        <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-left text-[12px]"><caption className="sr-only">Columns for the {labels[kind]} CSV</caption><thead><tr className="text-ink-3"><th className="py-1 pr-3 font-medium">Column</th><th className="py-1 pr-3 font-medium">Required</th><th className="py-1 pr-3 font-medium">Contents</th><th className="py-1 font-medium">Example</th></tr></thead>
          <tbody>{cols.map((c) => <tr key={c.name} className="border-t border-line align-top"><td className="py-1.5 pr-3 font-mono">{c.name}</td><td className="py-1.5 pr-3">{c.required ? "Yes" : "No"}</td><td className="py-1.5 pr-3 text-ink-2">{c.description}</td><td className="py-1.5 font-mono text-ink-3">{c.example}</td></tr>)}</tbody></table></div>
        <div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" onClick={() => download(CSV_FILE[kind], csvTemplate(kind, cfg))}><Download />Download template</Button></div>
        <div className="mt-4"><div className="eyebrow mb-1">Saved column mapping</div>
          {rows.map(([h, f], i) => (
            <div key={i} className="mb-1.5 flex items-center gap-2"><input aria-label="CSV header" value={h} maxLength={60} disabled={!editable} onChange={(e) => { const next = Object.entries(mapping); next[i] = [e.target.value, f]; onMap(Object.fromEntries(next)); }} className={cn(inputCls, "min-w-0 flex-1")} />
              <select aria-label={`Field for ${h}`} value={f} disabled={!editable} onChange={(e) => onMap({ ...mapping, [h]: e.target.value })} className={cn(selectCls, "w-40")}>{cols.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</select>
              <Button size="sm" variant="ghost" disabled={!editable} onClick={() => { const { [h]: _x, ...rest } = mapping; onMap(rest); }}>Remove</Button></div>
          ))}
          <Tip content={rows.length >= 30 ? "At most 30 mappings" : "Map a header from your export to a column"}><span tabIndex={0} className="inline-flex"><Button size="sm" disabled={!editable || rows.length >= 30} onClick={() => onMap({ ...mapping, [`Header ${rows.length + 1}`]: cols[0].name })}>Add mapping</Button></span></Tip>
        </div>
      </div>
    </details>
  );
}
