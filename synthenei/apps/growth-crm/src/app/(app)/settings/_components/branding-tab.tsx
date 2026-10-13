"use client";
// White-label branding (tenant-wide). Dragging the hue re-tints the whole app live via --brand-h on <html>;
// Save commits through the server action (primary owner only, never in a support session) and the shared
// useBrand() setter. Leaving the tab without saving restores the saved hue.
import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import { Check, ImageUp, Info, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Tip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { useBrand, useSession } from "@/components/shell/providers";
import { can } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import { saveBranding } from "./actions";
import { contrastChecks } from "./contrast";

/** Token overrides for a preview wrapper (derived tokens are computed on :root, so they must be restated). */
const previewVars = (h: number) => ({
  "--accent": `oklch(0.52 0.15 ${h})`, "--accent-ink": `oklch(0.99 0.005 ${h})`, "--accent-on-navy": `oklch(0.74 0.13 ${h})`,
  "--navy-900": `oklch(0.22 0.045 ${h})`, "--navy-800": `oklch(0.27 0.05 ${h})`, "--navy-ink": `oklch(0.96 0.01 ${h})`,
  "--navy-ink-2": `oklch(0.76 0.03 ${h})`, "--chart-1": `oklch(0.52 0.15 ${h})`,
}) as CSSProperties;

export function BrandingTab({ tenantName, workspaceCount, primaryOwnerName, defaultHue }: { tenantName: string; workspaceCount: number; primaryOwnerName: string; defaultHue: number }) {
  const { role, support, tenant } = useSession();
  const { brand, setBrand } = useBrand();
  const editable = !support && can("branding", { role, support }) && tenant.isPrimaryOwner;
  const [name, setName] = useState(brand.name);
  const [product, setProduct] = useState(brand.product);
  const [hue, setHue] = useState(brand.hue);
  const [pending, start] = useTransition();
  const saved = useRef(brand.hue);
  saved.current = brand.hue;

  // Sync form when the stored brand loads from localStorage after mount.
  useEffect(() => { setName(brand.name); setProduct(brand.product); setHue(brand.hue); }, [brand.name, brand.product, brand.hue]);
  // Live re-tint of the whole app while editing.
  useEffect(() => { document.documentElement.style.setProperty("--brand-h", String(hue)); }, [hue]);
  useEffect(() => () => { document.documentElement.style.setProperty("--brand-h", String(saved.current)); }, []);

  const checks = useMemo(() => contrastChecks(hue), [hue]);
  const minRatio = Math.min(...checks.map((c) => c.value));
  const passes = checks.every((c) => c.value >= c.min);
  const dirty = name !== brand.name || product !== brand.product || hue !== brand.hue;
  const reason = support ? "Not available in a support session." : !tenant.isPrimaryOwner ? `Only the tenant's primary owner (${primaryOwnerName}) can change branding.` : "Only the Owner can change branding.";

  const save = () => start(async () => {
    const r = await saveBranding({ name, product, hue });
    if (r.ok) setBrand({ name: name.trim(), product: product.trim(), hue });
    toast(r.message, r.detail);
  });
  const resetToTenant = () => { setHue(defaultHue); setName(tenantName); setProduct(tenant.product); };

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="lg:col-span-12">
        <p className="flex items-start gap-2 rounded-sm border border-line bg-surface px-3 py-2 text-[12px] leading-[18px] text-ink-2">
          <Info className="mt-px size-4 shrink-0 text-ink-3" aria-hidden />
          <span><span className="font-medium text-ink">Applies to all {tenantName} workspaces ({workspaceCount}).</span> {editable ? "Changes preview live across the app; Save keeps them." : `${reason} You are seeing a read-only preview.`}</span>
        </p>
      </div>

      <Card className="lg:col-span-5">
        <CardHeader title="Brand" sub="Name, logo and accent colour" />
        <CardBody>
          <fieldset disabled={!editable} className="flex flex-col gap-4 disabled:opacity-100">
            <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">Brand name
              <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="h-9 rounded-sm border border-line-strong bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-ring disabled:bg-paper-2 disabled:text-ink-2" />
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">Product name
              <input value={product} maxLength={40} onChange={(e) => setProduct(e.target.value)} className="h-9 rounded-sm border border-line-strong bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-ring disabled:bg-paper-2 disabled:text-ink-2" />
            </label>

            <div>
              <div className="mb-1 text-[12px] font-medium text-ink-2">Logo</div>
              <div className="flex items-center gap-3 rounded-sm border border-dashed border-line-strong px-3 py-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-sm bg-accent text-[16px] font-semibold text-accent-ink" aria-hidden>{(name || "?").trim()[0]?.toUpperCase()}</span>
                <div className="min-w-0 flex-1 text-[12px] leading-[18px] text-ink-3">SVG or PNG, light and dark versions. Upload needs Supabase Storage, which this demo does not use; the monogram stands in.</div>
                <Tip content="Upload is off in this demo (no Storage bucket)."><span tabIndex={0} className="inline-flex"><Button size="sm" disabled><ImageUp />Upload</Button></span></Tip>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="hue" className="text-[12px] font-medium text-ink-2">Accent hue</label>
                <output htmlFor="hue" className="font-mono text-[12px] text-ink num">{hue}°</output>
              </div>
              <div className="relative h-8">
                <div className="absolute inset-x-0 top-1/2 flex h-2.5 -translate-y-1/2 overflow-hidden rounded-full border border-line" aria-hidden>
                  {Array.from({ length: 36 }, (_, i) => <span key={i} className="h-full flex-1" style={{ background: `oklch(0.6 0.13 ${i * 10})` }} />)}
                </div>
                <input id="hue" type="range" min={0} max={359} step={1} value={hue} onChange={(e) => setHue(Number(e.target.value))}
                  aria-valuetext={`Hue ${hue} degrees, contrast ${minRatio.toFixed(1)} to 1, ${passes ? "passes" : "fails"} WCAG AA`}
                  className="relative h-8 w-full cursor-pointer appearance-none bg-transparent outline-none disabled:cursor-not-allowed [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-surface [&::-moz-range-thumb]:bg-accent [&::-moz-range-track]:bg-transparent [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-surface [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_var(--ink-3)] focus-visible:[&::-webkit-slider-thumb]:shadow-[0_0_0_3px_var(--ring)]" />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-ink-3 num"><span>0</span><span>Tenant default {defaultHue}</span><span>359</span></div>
            </div>
          </fieldset>

          <section aria-labelledby="contrast" className="mt-5 rounded-sm border border-line bg-paper px-3 py-3">
            <h3 id="contrast" className="eyebrow mb-2">Contrast check (WCAG AA, 4.5:1)</h3>
            <ul className="flex flex-col gap-1.5" aria-live="polite">
              {checks.map((c) => {
                const ok = c.value >= c.min;
                return (
                  <li key={c.key} className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="text-ink-2">{c.label}</span>
                    <span className={cn("inline-flex items-center gap-1 font-medium num", ok ? "text-success" : "text-danger")}>
                      {ok ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}{c.value.toFixed(2)}:1 {ok ? "pass" : "fail"}
                    </span>
                  </li>
                );
              })}
            </ul>
            {!passes && <p className="mt-2 text-[12px] text-danger">Save is blocked until every pair reaches 4.5:1.</p>}
          </section>

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            {editable ? (
              <>
                <Button variant="ghost" onClick={resetToTenant}><RotateCcw />Reset to tenant default</Button>
                <Button variant="primary" disabled={!dirty || !passes || pending} onClick={save}>{pending ? "Saving" : "Save branding"}</Button>
              </>
            ) : (
              <Tip content={reason}><span tabIndex={0} className="inline-flex"><Button variant="primary" disabled>Save branding</Button></span></Tip>
            )}
          </div>
        </CardBody>
      </Card>

      <Card className="self-start lg:col-span-7">
        <CardHeader title="Preview" sub="How the shell, buttons and the primary chart series look with this hue" />
        <CardBody className="flex flex-col gap-4">
          <BrandPreview hue={hue} name={name || tenantName} product={product} />
          <dl className="grid grid-cols-2 gap-3 text-[12px] xl:grid-cols-4">
            {[["Accent", "oklch(0.52 0.15 h)"], ["Navy", "oklch(0.22 0.045 h)"], ["On navy", "oklch(0.74 0.13 h)"], ["Paper", "fixed, hue 90"]].map(([k, v], i) => (
              <div key={k} className="flex items-center gap-2">
                <span className="size-5 shrink-0 rounded-[4px] border border-line" style={{ background: i === 3 ? "var(--paper)" : `oklch(${["0.52 0.15", "0.22 0.045", "0.74 0.13"][i]} ${hue})` }} aria-hidden />
                <div className="min-w-0"><dt className="text-ink-2">{k}</dt><dd className="truncate font-mono text-[10.5px] text-ink-3">{v}</dd></div>
              </div>
            ))}
          </dl>
          <p className="text-[12px] text-ink-3">Semantic colours (success, warning, danger) and the Showcase chip never change per tenant.</p>
        </CardBody>
      </Card>
    </div>
  );
}

/** Mini shell, shared look with /admin/tenants/[id] Branding (agreed with ADMIN). */
function BrandPreview({ hue, name, product }: { hue: number; name: string; product: string }) {
  return (
    <div style={previewVars(hue)} className="grid h-[200px] w-full grid-cols-[30%_1fr] overflow-hidden rounded-md border border-line" aria-label={`Preview of ${name} with hue ${hue}`} role="img">
      <div className="flex min-w-0 flex-col gap-3 bg-navy-900 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-[4px] bg-accent text-[11px] font-semibold text-accent-ink">{name.trim()[0]?.toUpperCase()}</span>
          <div className="min-w-0"><div className="truncate text-[12px] font-semibold text-navy-ink">{name}</div><div className="truncate text-[11px] text-navy-ink-2">{product}</div></div>
        </div>
        <div className="flex flex-col gap-1">
          {["Command Center", "Leads", "Pipeline"].map((l, i) => (
            <div key={l} className={cn("relative flex h-7 items-center truncate rounded-[4px] px-2.5 text-[11px]", i === 1 ? "bg-navy-800 text-navy-ink" : "text-navy-ink-2")}>
              {i === 1 && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-accent-on-navy" />}{l}
            </div>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-col justify-between bg-paper p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[12px] font-semibold text-ink">Leads this week</span>
          <span className="inline-flex h-7 shrink-0 items-center rounded-sm bg-accent px-3 text-[11px] font-medium text-accent-ink">New lead</span>
        </div>
        <div className="flex h-[96px] items-end gap-3 border-b border-line">
          {[40, 65, 50, 85].map((v, i) => <span key={i} className="flex-1 rounded-t-[3px] bg-chart-1" style={{ height: `${v}%`, opacity: i === 3 ? 1 : 0.55 }} />)}
        </div>
      </div>
    </div>
  );
}
