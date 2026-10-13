"use client";
// Tenant branding editor + live preview. Same preview markup as /settings (agreed with SYSTEM):
// mini shell, navy sidebar 30%, monogram, three nav rows, primary button and a 4-bar chart.
// The preview re-declares the derived tokens on its wrapper, because --accent etc. are computed on :root.
import { useId, useState, useTransition, type CSSProperties } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { saveBranding } from "./actions";
import { fieldCls } from "./action-dialog";

export const tokensFor = (h: number) => ({
  "--accent": `oklch(0.52 0.15 ${h})`, "--accent-ink": `oklch(0.99 0.005 ${h})`, "--accent-on-navy": `oklch(0.74 0.13 ${h})`,
  "--navy-900": `oklch(0.22 0.045 ${h})`, "--navy-800": `oklch(0.27 0.05 ${h})`, "--navy-ink": `oklch(0.96 0.01 ${h})`, "--navy-ink-2": `oklch(0.76 0.03 ${h})`,
  "--chart-1": `oklch(0.52 0.15 ${h})`,
}) as CSSProperties;

/** WCAG relative luminance of an OKLCH colour (OKLab -> linear sRGB, clamped). */
function lum(L: number, C: number, h: number) {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const c = (x: number) => Math.min(1, Math.max(0, x));
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(bl);
}
const ratio = (x: number, y: number) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);

export function BrandingEditor({ tenantId, initial }: { tenantId: string; initial: { name: string; product: string; hue: number; monogram: string } }) {
  const [name, setName] = useState(initial.name);
  const [product, setProduct] = useState(initial.product);
  const [hue, setHue] = useState(initial.hue);
  const [pending, start] = useTransition();
  const id = useId();
  const accent = lum(0.52, 0.15, hue), white = lum(0.99, 0.005, hue), surface = lum(0.995, 0.002, 90);
  const checks = [
    { label: "White text on accent", value: ratio(white, accent) },
    { label: "Accent text on surface", value: ratio(accent, surface) },
  ];
  const ok = checks.every((c) => c.value >= 4.5);
  const dirty = name !== initial.name || product !== initial.product || hue !== initial.hue;
  const save = () => start(async () => {
    const fd = new FormData(); fd.set("tenant", tenantId); fd.set("brand", name); fd.set("product", product); fd.set("hue", String(hue));
    const r = await saveBranding(fd); toast(r.message, r.sub);
  });
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-3">
        <div><label htmlFor={`${id}-n`} className="mb-1 block text-[12px] font-medium text-ink-2">Brand name</label><input id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} /></div>
        <div><label htmlFor={`${id}-p`} className="mb-1 block text-[12px] font-medium text-ink-2">Product name</label><input id={`${id}-p`} value={product} onChange={(e) => setProduct(e.target.value)} className={fieldCls} /></div>
        <div>
          <div className="mb-1 flex items-center justify-between"><label htmlFor={`${id}-h`} className="text-[12px] font-medium text-ink-2">Primary hue</label><output htmlFor={`${id}-h`} className="font-mono text-[12px] text-ink num">{hue}</output></div>
          <input id={`${id}-h`} type="range" min={0} max={359} step={1} value={hue} onChange={(e) => setHue(Number(e.target.value))} className="h-10 w-full accent-[var(--accent)]" style={tokensFor(hue)} />
        </div>
        <ul className="space-y-1 text-[12px]" aria-label="Contrast checks">
          {checks.map((c) => (
            <li key={c.label} className={cn("flex items-center gap-1.5", c.value >= 4.5 ? "text-ink-2" : "text-danger")}>
              {c.value >= 4.5 ? <Check className="size-3.5 text-success" aria-hidden /> : <X className="size-3.5" aria-hidden />}
              {c.label}: <span className="num font-medium">{c.value.toFixed(2)}:1</span> {c.value >= 4.5 ? "passes 4.5:1" : "below 4.5:1"}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="primary" onClick={save} disabled={!dirty || !ok || pending}>{pending ? "Saving…" : "Save branding"}</Button>
          <Button variant="ghost" onClick={() => { setName(initial.name); setProduct(initial.product); setHue(initial.hue); }} disabled={!dirty}>Reset to tenant default</Button>
        </div>
        <p className="text-[12px] text-ink-3">Applies to every workspace of this tenant. Workspace owners can also change it in Settings → Branding; support sessions cannot.</p>
      </div>
      <div style={tokensFor(hue)} aria-label={`Preview of ${name} branding at hue ${hue}`} role="img"
        className="grid h-[200px] w-full grid-cols-[30%_1fr] overflow-hidden rounded-md border border-line">
        <div className="flex min-w-0 flex-col gap-2 bg-navy-900 p-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-[5px] bg-accent text-[12px] font-semibold text-accent-ink">{initial.monogram}</span>
            <div className="min-w-0 leading-tight"><div className="truncate text-[12px] font-semibold text-navy-ink">{name || "Brand"}</div><div className="truncate text-[11px] text-navy-ink-2">{product}</div></div>
          </div>
          {["Pipeline", "Leads", "Campaigns"].map((n, i) => (
            <div key={n} className={cn("relative flex h-7 items-center rounded-[4px] px-2 text-[11px]", i === 0 ? "bg-navy-800 text-navy-ink" : "text-navy-ink-2")}>
              {i === 0 && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-accent-on-navy" />}<span className="truncate">{n}</span>
            </div>
          ))}
        </div>
        <div className="flex min-w-0 flex-col justify-between bg-paper p-4">
          <span className="inline-flex h-8 w-fit items-center rounded-sm bg-accent px-3 text-[12px] font-medium text-accent-ink">Add lead</span>
          <div className="flex h-20 items-end gap-2">
            {[40, 65, 50, 85].map((h, i) => <span key={i} className="w-6 rounded-t-[3px]" style={{ height: `${h}%`, background: "var(--chart-1)" }} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
