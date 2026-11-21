"use client";
// AI gateway settings (T050): limits, privacy, providers and the workspace's own key (BYOK). Owners edit; everyone else reads.
// The key field is write-only: a stored key is shown as "stored", never echoed back.
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { KeyRound, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { removeByok, savePolicy, saveByok, saveProvider } from "../gateway-actions";

export interface ProviderVM { provider: "anthropic" | "openai" | "google"; label: string; enabled: boolean; defaultModel: string | null; hasSecret: boolean; models: { id: string; label: string }[] }
export interface SettingsVM {
  canEdit: boolean;
  policy: { monthlyCallCap: number | null; monthlyTokenCap: number | null; perUserDailyCap: number | null; piiRedaction: boolean; storePrompts: "none" | "redacted" | "full" };
  usage: { calls: number; tokens: number; userToday: number; planCalls: number | null } | null;
  providers: ProviderVM[];
}

const field = "h-9 w-full rounded-sm border border-line-strong bg-surface px-2.5 text-[13px] outline-none placeholder:text-ink-3 focus:border-ring disabled:opacity-60";
const fmt = (n: number | null) => (n == null ? "" : String(n));
const nz = (s: string) => (s.trim() === "" ? null : Number(s));

export function GatewaySettings({ vm }: { vm: SettingsVM }) {
  const t = useTranslations("ai");
  const [pending, start] = useTransition();
  const [calls, setCalls] = useState(fmt(vm.policy.monthlyCallCap)), [tokens, setTokens] = useState(fmt(vm.policy.monthlyTokenCap)), [perUser, setPerUser] = useState(fmt(vm.policy.perUserDailyCap));
  const [pii, setPii] = useState(vm.policy.piiRedaction), [store, setStore] = useState(vm.policy.storePrompts);
  const [rows, setRows] = useState(vm.providers);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const ro = !vm.canEdit || pending;
  const done = (r: { ok: boolean; message: string; sub?: string }) => toast(r.message, r.sub);

  const patch = (p: string, v: Partial<ProviderVM>) => setRows((xs) => xs.map((x) => (x.provider === p ? { ...x, ...v } : x)));
  const meter = (label: string, used: number, cap: number | null) => (
    <div>
      <div className="flex justify-between text-[12px]"><span className="text-ink-2">{label}</span><span className="num text-ink-3">{used.toLocaleString()}{cap != null ? ` / ${cap.toLocaleString()}` : ` / ${t("settings.noCap")}`}</span></div>
      <div className="mt-1 h-1.5 rounded-full bg-paper-2" aria-hidden><div className={cn("h-full rounded-full", cap != null && used >= cap ? "bg-danger" : "bg-accent")} style={{ width: cap ? `${Math.min(100, (used / Math.max(1, cap)) * 100)}%` : "0%" }} /></div>
    </div>
  );

  return (
    <div className="space-y-6" data-cy="ai-settings">
      {!vm.canEdit && <p className="text-[12px] text-ink-3">{t("settings.ownerOnly")}</p>}

      <section aria-labelledby="ai-limits">
        <h3 id="ai-limits" className="text-[13px] font-semibold text-ink">{t("settings.limits")}</h3>
        <p className="mt-0.5 text-[12px] text-ink-3">{t("settings.limitsSub")}</p>
        {vm.usage && (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {meter(t("settings.callsMonth"), vm.usage.calls, vm.policy.monthlyCallCap)}
            {meter(t("settings.tokensMonth"), vm.usage.tokens, vm.policy.monthlyTokenCap)}
            {meter(t("settings.userToday"), vm.usage.userToday, vm.policy.perUserDailyCap)}
          </div>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-[12px] text-ink-2">{t("settings.callCap")}<input data-cy="cap-calls" className={cn(field, "mt-1")} inputMode="numeric" value={calls} onChange={(e) => setCalls(e.target.value)} disabled={ro} placeholder={t("settings.noCap")} /></label>
          <label className="text-[12px] text-ink-2">{t("settings.tokenCap")}<input data-cy="cap-tokens" className={cn(field, "mt-1")} inputMode="numeric" value={tokens} onChange={(e) => setTokens(e.target.value)} disabled={ro} placeholder={t("settings.noCap")} /></label>
          <label className="text-[12px] text-ink-2">{t("settings.userCap")}<input data-cy="cap-user" className={cn(field, "mt-1")} inputMode="numeric" value={perUser} onChange={(e) => setPerUser(e.target.value)} disabled={ro} placeholder={t("settings.noCap")} /></label>
        </div>
        {vm.usage?.planCalls != null && <p className="mt-2 text-[11px] text-ink-3">{t("settings.planLimit", { n: vm.usage.planCalls.toLocaleString() })}</p>}
      </section>

      <section aria-labelledby="ai-privacy">
        <h3 id="ai-privacy" className="text-[13px] font-semibold text-ink">{t("settings.privacy")}</h3>
        <label className="mt-2 flex items-start gap-2.5 text-[13px] text-ink">
          <input type="checkbox" checked={pii} onChange={(e) => setPii(e.target.checked)} disabled={ro} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>{t("settings.piiExtended")}<span className="block text-[12px] text-ink-3">{t("settings.piiCore")}</span></span>
        </label>
        <label className="mt-3 block text-[12px] text-ink-2">{t("settings.store")}
          <select data-cy="store-prompts" className={cn(field, "mt-1 max-w-xs")} value={store} onChange={(e) => setStore(e.target.value as typeof store)} disabled={ro}>
            <option value="none">{t("settings.storeNone")}</option><option value="redacted">{t("settings.storeRedacted")}</option><option value="full">{t("settings.storeFull")}</option>
          </select>
        </label>
        <div className="mt-3"><Button variant="primary" size="sm" disabled={ro} onClick={() => start(async () => done(await savePolicy({ monthlyCallCap: nz(calls), monthlyTokenCap: nz(tokens), perUserDailyCap: nz(perUser), piiRedaction: pii, storePrompts: store })))}>{t("settings.save")}</Button></div>
      </section>

      <section aria-labelledby="ai-providers">
        <h3 id="ai-providers" className="text-[13px] font-semibold text-ink">{t("settings.providers")}</h3>
        <p className="mt-0.5 text-[12px] text-ink-3">{t("settings.providersSub")}</p>
        <ul className="mt-3 space-y-3">
          {rows.map((p) => (
            <li key={p.provider} className="rounded-md border border-line p-3" data-cy={`provider-${p.provider}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium text-ink">{p.label}</span>
                {p.hasSecret ? <Badge tone="success">{t("settings.ownKey")}</Badge> : <Badge tone="outline">{t("settings.platformKey")}</Badge>}
                <label className="ml-auto flex items-center gap-2 text-[12px] text-ink-2"><input type="checkbox" checked={p.enabled} onChange={(e) => patch(p.provider, { enabled: e.target.checked })} disabled={ro} className="size-4 accent-[var(--accent)]" />{t("settings.enabled")}</label>
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="text-[12px] text-ink-2">{t("settings.model")}
                  <select className={cn(field, "mt-1")} value={p.defaultModel ?? ""} onChange={(e) => patch(p.provider, { defaultModel: e.target.value || null })} disabled={ro}>
                    <option value="">{t("settings.modelAuto")}</option>{p.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </label>
                <label className="text-[12px] text-ink-2">{t("settings.key")}
                  <span className="mt-1 flex gap-2">
                    <input type="password" autoComplete="off" spellCheck={false} data-cy={`key-${p.provider}`} className={field} value={keys[p.provider] ?? ""} onChange={(e) => setKeys((k) => ({ ...k, [p.provider]: e.target.value }))} disabled={ro} placeholder={p.hasSecret ? t("settings.keyStored") : t("settings.keyPlaceholder")} />
                    <Button size="sm" disabled={ro || !(keys[p.provider] ?? "").trim()} onClick={() => start(async () => { const r = await saveByok(p.provider, keys[p.provider] ?? ""); done(r); if (r.ok) { setKeys((k) => ({ ...k, [p.provider]: "" })); patch(p.provider, { hasSecret: true }); } })}><KeyRound />{t("settings.saveKey")}</Button>
                    {p.hasSecret && <Button size="sm" variant="ghost" aria-label={t("settings.removeKey")} disabled={ro} onClick={() => start(async () => { const r = await removeByok(p.provider); done(r); if (r.ok) patch(p.provider, { hasSecret: false }); })}><Trash2 /></Button>}
                  </span>
                </label>
              </div>
              <div className="mt-3"><Button size="sm" disabled={ro} onClick={() => start(async () => done(await saveProvider({ provider: p.provider, enabled: p.enabled, defaultModel: p.defaultModel, allowedModels: [] })))}>{t("settings.saveProvider")}</Button></div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
