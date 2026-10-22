"use client";
// Configuration editor shell: section tabs + provider. Used by Settings -> Configuration (scope "org") and by the
// admin console tenant page (scope "platform", which adds the reason field and the platform-only sections).
import type { ReactNode } from "react";
import { Tabs } from "@/components/ui/tabs";
import { CategoriesSection, BrandingSection, DashboardSection, DataSection, ModulesSection, StagesSection, WordingSection } from "./config-sections";
import { HistorySection, type HistoryRow } from "./config-history";
import { ConfigProvider, inputCls, type ActionRes, type EditorCtx } from "./config-shared";
import type { TenantConfig } from "@/lib/config/types";
import { useState } from "react";

/** Server action references (serializable); the editor binds the tenant id and reason. */
export interface RawActions {
  save(tenantId: string, patch: unknown, reason?: string): Promise<ActionRes>;
  reset(tenantId: string, sections: (keyof TenantConfig)[], reason?: string): Promise<ActionRes>;
  rollback(tenantId: string, version: number, reason?: string): Promise<ActionRes>;
}
export type ConfigEditorProps = Omit<EditorCtx, "reason" | "actions"> & { actions: RawActions; history: HistoryRow[]; version: number; extra?: { value: string; label: string; content: ReactNode }[] };

export function ConfigEditor({ history, version, extra = [], actions: raw, ...c }: ConfigEditorProps) {
  const ctx = { ...c, actions: { save: (p: unknown, r?: string) => raw.save(c.tenantId, p, r), reset: (s: (keyof TenantConfig)[], r?: string) => raw.reset(c.tenantId, s, r), rollback: (v: number, r?: string) => raw.rollback(c.tenantId, v, r) } };
  const [reason, setReason] = useState("");
  return (
    <ConfigProvider value={{ ...ctx, reason }}>
      {ctx.scope === "platform" && (
        <div className="mb-4 rounded-md border border-line bg-surface px-4 py-3 shadow-1">
          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">Reason for changes (recorded in the audit log with your name)
            <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Owner asked by phone to rename Enquiries to Requests (ticket SUP-204)" className={`${inputCls} h-9 w-full`} />
          </label>
        </div>
      )}
      <Tabs tabs={[
        { value: "wording", label: "Wording", content: <WordingSection /> },
        { value: "stages", label: "Stages", content: <StagesSection /> },
        { value: "categories", label: "Categories", content: <CategoriesSection /> },
        { value: "modules", label: "Modules", content: <ModulesSection /> },
        { value: "dashboard", label: "Dashboard", content: <DashboardSection /> },
        { value: "branding", label: "Branding and fonts", content: <BrandingSection /> },
        { value: "data", label: "Data and import", content: <DataSection /> },
        ...extra,
        { value: "history", label: "History", content: <HistorySection rows={history} version={version} demoNote={ctx.savedCopy.includes("demo")} /> },
      ]} />
      <p className="mt-3 text-[12px] text-ink-3">{ctx.savedCopy}. Reset to preset puts a section back to the starting template for this tenant's preset.</p>
    </ConfigProvider>
  );
}
