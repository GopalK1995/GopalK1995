"use client";
import * as M from "@radix-ui/react-dropdown-menu";
import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useSession, useVocab } from "./providers";
import { can } from "@/lib/auth/roles";
import { switchWorkspace } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";

function Monogram({ letter, size = 28, onNavy = true }: { letter: string; size?: number; onNavy?: boolean }) {
  return <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-[6px] font-semibold", onNavy ? "bg-accent text-accent-ink" : "bg-accent text-accent-ink")} style={{ width: size, height: size, fontSize: size * 0.46 }}>{letter}</span>;
}

/** Workspace switcher: tenant monogram + workspace + my role. Grouped by tenant, searchable past 5. */
export function WorkspaceSwitcher({ collapsed, onNavy = true }: { collapsed?: boolean; onNavy?: boolean }) {
  const s = useSession();
  const vv = useVocab();
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const groups = useMemo(() => {
    const list = s.workspaces.filter((w) => `${w.tenantName} ${w.name}`.toLowerCase().includes(q.toLowerCase()));
    return [...new Set(list.map((w) => w.tenantName))].map((t) => ({ tenant: t, items: list.filter((w) => w.tenantName === t) }));
  }, [s.workspaces, q]);
  return (
    <M.Root>
      <M.Trigger data-testid="ws-switcher" disabled={!!s.support} aria-label={`Workspace: ${s.tenant.name} · ${s.ws.name}. Switch workspace`}
        className={cn("group flex w-full items-center gap-2.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
          onNavy ? "p-1.5 hover:bg-navy-800" : "p-1 hover:bg-paper-2", collapsed && "justify-center", pending && "opacity-60")}>
        <Monogram letter={s.tenant.monogram} />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 leading-tight">
              <span className={cn("block truncate text-[13px] font-semibold", onNavy ? "text-navy-ink" : "text-ink")}>{s.tenant.name}</span>
              <span className={cn("flex items-center gap-1.5 truncate text-[11px]", onNavy ? "text-navy-ink-3" : "text-ink-3")}>
                <span className="truncate">{s.ws.name}</span>
                <span className={cn("shrink-0 rounded-[3px] px-1 text-[10px]", onNavy ? "bg-navy-800 text-navy-ink-2" : "bg-paper-2 text-ink-2")}>{vv.role[s.role]}</span>
              </span>
            </span>
            {!s.support && <ChevronsUpDown className={cn("size-4 shrink-0", onNavy ? "text-navy-ink-3" : "text-ink-3")} aria-hidden />}
          </>
        )}
      </M.Trigger>
      <M.Portal>
        <M.Content align="start" sideOffset={6} className="z-[60] w-[288px] rounded-md border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-[pop_150ms_ease-out]">
          {s.workspaces.length > 5 && (
            <div className="relative mb-1 p-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Find workspace" aria-label="Find workspace" className="h-8 w-full rounded-sm border border-line bg-paper pl-7 pr-2 text-[13px] outline-none focus:border-ring" />
            </div>
          )}
          {groups.map((g) => (
            <M.Group key={g.tenant}>
              <M.Label className="px-2 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-3">{g.tenant}</M.Label>
              {g.items.map((w) => (
                <M.Item key={w.id} data-ws={w.id} onSelect={() => { if (w.id !== s.ws.id) start(() => switchWorkspace(w.id)); }}
                  className="flex h-10 cursor-default items-center gap-2.5 rounded-sm px-2 text-[13px] outline-none data-[highlighted]:bg-paper-2">
                  <Monogram letter={w.monogram} size={22} onNavy={false} />
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink">{w.name}</span><span className="block text-[11px] text-ink-3">{vv.role[w.role]}</span></span>
                  {w.id === s.ws.id && <Check className="size-4 text-accent" aria-label="Current" />}
                </M.Item>
              ))}
            </M.Group>
          ))}
          {!groups.length && <div className="px-2 py-3 text-[12px] text-ink-3">No workspace matches “{q}”.</div>}
          <M.Separator className="my-1 h-px bg-line" />
          <M.Item disabled={!can("createWorkspace", { role: s.role, support: s.support })} onSelect={() => toast(`New workspace in ${s.tenant.name}`, "Demo: create_workspace() would run here; nothing was created.")}
            className="flex h-9 cursor-default items-center gap-2 rounded-sm px-2 text-[13px] text-ink-2 outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-paper-2">
            <Plus className="size-4 text-ink-3" aria-hidden />Create workspace{s.role !== "owner" && <span className="ml-auto text-[11px] text-ink-3">Owner only</span>}
          </M.Item>
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
