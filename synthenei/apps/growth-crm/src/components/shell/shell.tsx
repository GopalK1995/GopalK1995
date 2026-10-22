"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import * as D from "@radix-ui/react-dialog";
import { ChevronDown, Database, Ellipsis, LogOut, Menu as MenuIcon, PanelLeftClose, PanelLeftOpen, Repeat, Search, ShieldAlert, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isActive, mobileNavFor, navFor, navGroup, navLabel } from "./nav";
import { WorkspaceSwitcher } from "./switcher";
import { endSupport } from "@/lib/auth/actions";
import { fmtTime } from "@/lib/format";
import { useSession, useVocab } from "./providers";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSep, MenuTrigger } from "@/components/ui/dropdown";
import { Tip } from "@/components/ui/tooltip";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { logout } from "@/lib/auth/actions";
import { Toaster } from "@/components/ui/toast";

const COLLAPSE_KEY = "gcrm-nav-collapsed";

function NavList({ collapsed, onNavigate, layoutKey }: { collapsed: boolean; onNavigate?: () => void; layoutKey: string }) {
  const path = usePathname();
  const { role, tenant } = useSession();
  const v = useVocab();
  const reduce = useReducedMotion();
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {navFor(role, tenant).map((g) => (
        <div key={g.group}>
          {!collapsed && <div className="mb-1 px-3 text-[10.5px] font-medium uppercase tracking-[0.08em] text-navy-ink-3">{navGroup(v, g.group)}</div>}
          <ul className="flex flex-col gap-0.5">
            {g.items.map((it) => {
              const active = isActive(it.href, path);
              const link = (
                <Link href={it.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
                  className={cn("relative flex h-9 items-center gap-3 rounded-sm px-3 text-[13px] font-medium outline-none transition-colors duration-150",
                    active ? "text-navy-ink" : "text-navy-ink-2 hover:bg-navy-800/70 hover:text-navy-ink", collapsed && "justify-center px-0")}>
                  {active && (
                    <motion.span layoutId={`nav-active-${layoutKey}`} className="absolute inset-0 rounded-sm bg-navy-800" transition={reduce ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
                      <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent-on-navy" />
                    </motion.span>
                  )}
                  <it.icon className={cn("relative size-4 shrink-0", active && "text-accent-on-navy")} aria-hidden />
                  {!collapsed && <span className="relative truncate">{navLabel(v, it)}</span>}
                  {!collapsed && it.badge && <span className="relative ml-auto rounded-[3px] border border-navy-line px-1 text-[10px] font-normal text-navy-ink-3">{it.badge}</span>}
                </Link>
              );
              return <li key={it.href}>{collapsed ? <Tip content={navLabel(v, it)} side="right">{link}</Tip> : link}</li>;
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SupportBanner() {
  const { support } = useSession();
  if (!support) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warn/40 bg-warn-soft px-4 py-2 text-[12px] text-warn-ink sm:px-6">
      <ShieldAlert className="size-4 shrink-0" aria-hidden />
      <span className="font-semibold">Support session by {support.admin} (Synthan) · {support.mode === "read_only" ? "read-only" : "read-write"} · ends {fmtTime(new Date(support.endsAt).toISOString())} IST</span>
      <span className="min-w-0 truncate">Reason: “{support.reason}” · logged</span>
      <form action={endSupport} className="ml-auto"><button className="h-7 rounded-sm border border-warn/50 bg-surface px-2.5 font-medium text-warn-ink hover:bg-warn-soft">End now</button></form>
    </div>
  );
}

function DemoChip({ collapsed }: { collapsed?: boolean }) {
  const s = useSession();
  if (collapsed) return <Tip content={`Sample data: synthetic ${s.tenant.name} · ${s.ws.name}. Nothing is sent.`} side="right"><span className="mx-auto block size-2 rounded-full bg-chart-2" /></Tip>;
  return (
    <div className="rounded-sm border border-navy-line px-3 py-2 text-[11px] leading-4 text-navy-ink-3">
      <div className="flex items-center gap-1.5 text-navy-ink-2"><span className="size-1.5 rounded-full bg-chart-2" aria-hidden />Sample data</div>
      <div className="mt-0.5">Synthetic {s.tenant.name} · {s.ws.name} data{s.demo ? " · demo login" : ""}. Nothing is sent.</div>
    </div>
  );
}

function UserMenu() {
  const s = useSession();
  const router = useRouter();
  return (
    <Menu>
      <MenuTrigger className="flex items-center gap-2 rounded-sm py-1 pl-1 pr-1.5 outline-none hover:bg-paper-2 focus-visible:ring-2 focus-visible:ring-ring" aria-label="User menu">
        <Avatar name={s.name} size={28} />
        <span className="hidden text-left leading-tight md:block">
          <span className="block text-[12px] font-medium text-ink">{s.name}</span>
          <span className="block text-[11px] text-ink-3">{ROLE_LABEL[s.role]}</span>
        </span>
        <ChevronDown className="hidden size-3.5 text-ink-3 md:block" aria-hidden />
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>Signed in as</MenuLabel>
        <div className="px-2 pb-2 text-[12px]"><div className="font-medium text-ink">{s.name}</div><div className="text-ink-3">{s.email} · {ROLE_LABEL[s.role]}</div></div>
        <MenuSep />
        <MenuItem onSelect={() => router.push("/profile")}><UserRound />Profile</MenuItem>
        {s.demo && <MenuItem onSelect={() => { void logout(); }}><Repeat />Switch persona</MenuItem>}
        <MenuItem onSelect={() => { void logout(); }}><LogOut />Log out</MenuItem>
      </MenuContent>
    </Menu>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const v = useVocab();
  const [q, setQ] = useState("");
  return (
    <form role="search" onSubmit={(e) => { e.preventDefault(); router.push(`/leads?q=${encodeURIComponent(q)}`); }} className="relative hidden w-full max-w-sm sm:block">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={v.search} aria-label={v.search}
        className="h-8 w-full rounded-sm border border-line bg-paper pl-8 pr-10 text-[13px] text-ink placeholder:text-ink-3 outline-none focus:border-ring focus:bg-surface" />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-[3px] border border-line px-1 text-[10px] text-ink-3">/</kbd>
    </form>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const { role, support, tenant } = useSession();
  const v = useVocab();
  const path = usePathname();
  useEffect(() => { try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1"); } catch { /* ignore */ } }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); document.querySelector<HTMLInputElement>('input[role="search"], form[role="search"] input')?.focus(); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch { /* ignore */ } return !c; });

  return (
    <div className="flex min-h-dvh">
      <aside className={cn("hidden shrink-0 self-stretch bg-navy-900 transition-[width] duration-200 ease-out lg:block", collapsed ? "w-16" : "w-60")}>
        <div className="sticky top-0 flex h-dvh flex-col">
        <div className={cn("flex h-14 items-center border-b border-navy-line", collapsed ? "justify-center px-2" : "px-2.5")}><WorkspaceSwitcher collapsed={collapsed} /></div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-2 py-4"><NavList collapsed={collapsed} layoutKey="desk" /></div>
        <div className="space-y-2 border-t border-navy-line p-3">
          <DemoChip collapsed={collapsed} />
          <button onClick={toggle} className={cn("flex h-8 w-full items-center gap-2 rounded-sm px-2 text-[12px] text-navy-ink-3 hover:bg-navy-800 hover:text-navy-ink", collapsed && "justify-center")} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" />Collapse</>}
          </button>
        </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {support && <SupportBanner />}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur-[2px] sm:px-6">
          <D.Root open={open} onOpenChange={setOpen}>
            <D.Trigger className="-ml-1 rounded-sm p-1.5 text-ink-2 hover:bg-paper-2 lg:hidden" aria-label="Open navigation"><MenuIcon className="size-5" /></D.Trigger>
            <D.Portal>
              <D.Overlay className="fixed inset-0 z-50 bg-navy-950/50 lg:hidden" />
              <D.Content className="fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col bg-navy-900 shadow-pop outline-none data-[state=open]:animate-[fade_150ms_ease-out] lg:hidden">
                <D.Title className="sr-only">Navigation</D.Title>
                <div className="flex h-14 items-center justify-between gap-2 border-b border-navy-line px-2.5"><div className="min-w-0 flex-1"><WorkspaceSwitcher /></div><D.Close className="rounded-sm p-1 text-navy-ink-2 hover:bg-navy-800" aria-label="Close navigation"><X className="size-5" /></D.Close></div>
                <div className="flex-1 overflow-y-auto px-2 py-4"><NavList collapsed={false} onNavigate={() => setOpen(false)} layoutKey="drawer" /></div>
                <div className="border-t border-navy-line p-3"><DemoChip /></div>
              </D.Content>
            </D.Portal>
          </D.Root>
          <div className="min-w-0 max-w-[200px] lg:hidden"><WorkspaceSwitcher onNavy={false} /></div>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-[4px] border border-line px-2 py-1 text-[11px] text-ink-3 md:inline-flex" title="All figures are synthetic sample data">
              <Database className="size-3" aria-hidden />Sample data · IST
            </span>
            <UserMenu />
          </div>
        </header>
        <Toaster />
        <main key={path} className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-10">{children}</main>
      </div>

      <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-navy-line bg-navy-900 pb-[env(safe-area-inset-bottom)] lg:hidden">
        {mobileNavFor(role, tenant).slice(0, 4).map((it) => {
          const active = isActive(it.href, path);
          return (
            <Link key={it.href} href={it.href} className={cn("relative flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium", active ? "text-navy-ink" : "text-navy-ink-3")} aria-current={active ? "page" : undefined}>
              {active && <span className="absolute inset-x-5 top-0 h-0.5 rounded-b-full bg-accent-on-navy" />}
              <it.icon className={cn("size-[18px]", active && "text-accent-on-navy")} aria-hidden />
              <span className="max-w-full truncate px-1">{it.label === "Command Center" ? "Overview" : navLabel(v, it)}</span>
            </Link>
          );
        })}
        <button onClick={() => setOpen(true)} className="flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium text-navy-ink-3" aria-label="More destinations">
          <Ellipsis className="size-[18px]" aria-hidden /><span>More</span>
        </button>
      </nav>
    </div>
  );
}
