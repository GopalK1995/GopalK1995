"use client";
import { SyncStatusChip, PresenceFacesView } from "@/components/realtime";
import { usePresence } from "@/lib/realtime/hooks";
import { tableTopic } from "@/lib/realtime/topics";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import * as D from "@radix-ui/react-dialog";
import { ChevronDown, Database, Ellipsis, LogOut, Menu as MenuIcon, PanelLeftClose, PanelLeftOpen, Repeat, Search, ShieldAlert, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isActive, mobileNavFor, navBadge, navFor, navGroup, navLabel } from "./nav";
import { LanguageMenuItems } from "./language-switcher";
import { WorkspaceSwitcher } from "./switcher";
import { endSupport } from "@/lib/auth/actions";
import { SampleDataDot } from "./sample-data-dot";
import { fmtTime } from "@/lib/format";
import { useSession, useVocab } from "./providers";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSep, MenuTrigger } from "@/components/ui/dropdown";
import { Tip } from "@/components/ui/tooltip";
import { logout } from "@/lib/auth/actions";
import { Toaster } from "@/components/ui/toast";
import { Kbd } from "@/components/ui/kbd";
import { PendingButton } from "@/components/ui/submit-button";
import { CommandPalette, ShortcutHelp, openCommandPalette, useSingleKeyShortcuts } from "@/components/command";

const COLLAPSE_KEY = "gcrm-nav-collapsed";

function NavList({ collapsed, onNavigate, layoutKey }: { collapsed: boolean; onNavigate?: () => void; layoutKey: string }) {
  const path = usePathname();
  const { role, tenant, objects } = useSession();
  const v = useVocab();
  const reduce = useReducedMotion();
  const t = useTranslations("shell");
  return (
    <nav aria-label={t("mainNav")} className="flex flex-col gap-5">
      {navFor(role, tenant, objects).map((g) => (
        <div key={g.group}>
          {!collapsed && <div className="mb-1 px-3 text-[10.5px] font-medium uppercase tracking-[0.08em] text-navy-ink-3">{navGroup(v, g.group, t)}</div>}
          <ul className="flex flex-col gap-0.5">
            {g.items.map((it) => {
              const active = isActive(it.href, path);
              const link = (
                <Link href={it.href} prefetch={it.perm || it.permOnly ? false : undefined} onClick={onNavigate} aria-current={active ? "page" : undefined}
                  className={cn("relative flex h-9 items-center gap-3 rounded-sm px-3 text-[13px] font-medium focus-ring-inset transition-colors duration-150",
                    active ? "text-navy-ink" : "text-navy-ink-2 hover:bg-navy-800/70 hover:text-navy-ink", collapsed && "justify-center px-0")}>
                  {active && (
                    <motion.span layoutId={`nav-active-${layoutKey}`} className="absolute inset-0 rounded-sm bg-navy-800" transition={reduce ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
                      <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent-on-navy" />
                    </motion.span>
                  )}
                  <it.icon className={cn("relative size-4 shrink-0", active && "text-accent-on-navy")} aria-hidden />
                  {!collapsed && <span className="relative truncate">{navLabel(v, it, t)}</span>}
                  {!collapsed && it.badge && <span className="relative ml-auto rounded-[3px] border border-navy-line px-1 text-[10px] font-normal text-navy-ink-3">{navBadge(it.badge, t)}</span>}
                </Link>
              );
              return <li key={it.href}>{collapsed ? <Tip content={navLabel(v, it, t)} side="right">{link}</Tip> : link}</li>;
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SupportBanner() {
  const { support } = useSession();
  const t = useTranslations("shell");
  if (!support) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warn/40 bg-warn-soft px-4 py-2 text-[12px] text-warn-ink sm:px-6">
      <ShieldAlert className="size-4 shrink-0" aria-hidden />
      <span className="font-semibold">{t("support.banner", { admin: support.admin, mode: support.mode === "read_only" ? t("support.readOnly") : t("support.readWrite"), time: fmtTime(new Date(support.endsAt).toISOString()) })}</span>
      <span className="min-w-0 truncate">{t("support.reason", { reason: support.reason })}</span>
      <form action={endSupport} className="ml-auto"><PendingButton className="h-7 rounded-sm border border-warn/50 bg-surface px-2.5 font-medium text-warn-ink hover:bg-warn-soft">{t("support.endNow")}</PendingButton></form>
    </div>
  );
}

function DemoChip({ collapsed }: { collapsed?: boolean }) {
  const s = useSession();
  const t = useTranslations("shell");
  if (collapsed) return <SampleDataDot label={t("demoDot", { tenant: s.tenant.name, ws: s.ws.name })} />;
  return (
    <div className="rounded-sm border border-navy-line px-3 py-2 text-[11px] leading-4 text-navy-ink-3">
      <div className="flex items-center gap-1.5 text-navy-ink-2"><span className="size-1.5 rounded-full bg-chart-2" aria-hidden />{t("sampleData")}</div>
      <div className="mt-0.5">{t(s.demo ? "demoNoteLogin" : "demoNote", { tenant: s.tenant.name, ws: s.ws.name })}</div>
    </div>
  );
}

function UserMenu() {
  const s = useSession();
  const v = useVocab();
  const router = useRouter();
  const t = useTranslations("shell");
  return (
    <Menu>
      {/* Name leads with the purpose ("User menu"), then the visible name and role in order. The avatar initials are drawn
          with CSS content (pseudo) so they are not DOM text and the label need not start with them (A11Y-020); the
          separating spaces between the name and role spans keep them from fusing into one token for axe's
          label-content-name-mismatch check. */}
      <MenuTrigger className="flex items-center gap-2 rounded-sm py-1 pl-1 pr-1.5 outline-none hover:bg-paper-2 focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${t("userMenu")}, ${s.name}, ${v.role[s.role]}`}>
        <Avatar name={s.name} size={28} pseudo />{" "}
        <span className="hidden text-left leading-tight md:block">
          <span className="block text-[12px] font-medium text-ink">{s.name}</span>{" "}
          <span className="block text-[11px] text-ink-3">{v.role[s.role]}</span>
        </span>
        <ChevronDown className="hidden size-3.5 text-ink-3 md:block" aria-hidden />
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>{t("signedInAs")}</MenuLabel>
        <div className="px-2 pb-2 text-[12px]"><div className="font-medium text-ink">{s.name}</div><div className="text-ink-3">{s.email} · {v.role[s.role]}</div></div>
        <MenuSep />
        <MenuItem onSelect={() => router.push("/profile")}><UserRound />{t("profile")}</MenuItem>
        {s.demo && <MenuItem onSelect={() => { void logout(); }}><Repeat />{t("switchPersona")}</MenuItem>}
        <MenuSep />
        <LanguageMenuItems />
        <MenuSep />
        <MenuItem onSelect={() => { void logout(); }}><LogOut />{t("logOut")}</MenuItem>
      </MenuContent>
    </Menu>
  );
}

/** Command chip: the primary global search and action surface (§3.2 chrome). An input-like trigger that opens the palette; shows the ⌘K / Ctrl K hint. */
function CommandChip() {
  const v = useVocab();
  const [keys, setKeys] = useState("Ctrl K");
  useEffect(() => {
    const ua = typeof navigator !== "undefined" ? (navigator.platform || navigator.userAgent) : "";
    if (/Mac|iPhone|iPad|iPod/.test(ua)) setKeys("⌘ K");
  }, []);
  return (
    // aria-label mirrors the full visible content (incl. the shortcut hint) with real spaces: the visible <span> and
    // <Kbd> are adjacent JSX siblings with only CSS gap between them, no literal whitespace, which fuses their text
    // into one unsplittable token for axe's label-content-name-mismatch check (and for screen readers reading raw
    // text content). A constant aria-label also keeps a sensible name when the text/kbd are responsively hidden below `sm`.
    <button type="button" onClick={() => openCommandPalette()} aria-keyshortcuts="Meta+K Control+K" aria-label={`${v.search} ${keys}`}
      className="inline-flex h-8 items-center gap-2 rounded-control border border-line bg-paper px-2.5 text-[13px] text-ink-3 outline-none hover:bg-paper-2 focus-visible:ring-2 focus-visible:ring-ring sm:w-full sm:max-w-sm">
      <Search className="size-4 shrink-0" aria-hidden />
      <span className="hidden min-w-0 flex-1 truncate text-left sm:block">{v.search}</span>{" "}
      <Kbd className="ml-auto hidden sm:inline-flex [@media(hover:none)]:hidden" aria-hidden>{keys}</Kbd>
    </button>
  );
}

/** Page title in the top bar (§3.2 chrome). A label derived from the active nav item, not the page's own <h1>, so it never competes with the document heading. */
function PageTitle() {
  const path = usePathname();
  const { role, tenant, objects } = useSession();
  const v = useVocab();
  const t = useTranslations("shell");
  const match = navFor(role, tenant, objects).flatMap((g) => g.items).filter((it) => isActive(it.href, path)).sort((a, b) => b.href.length - a.href.length)[0];
  const seg = path.replace(/^\//, "").split("/")[0].replace(/-/g, " ");
  const title = match ? navLabel(v, match, t) : seg ? `${seg[0].toUpperCase()}${seg.slice(1)}` : navLabel(v, { href: "/", label: "Command Center", icon: Database }, t);
  return <div className="hidden min-w-0 items-center lg:flex"><span className="truncate text-[14px] font-semibold text-ink">{title}</span></div>;
}

/** Workspace presence in the chrome (§3.2): colleagues currently in this workspace (sample colleagues in demo). Renders nothing when you are alone. */
function ShellPresence() {
  const { ws } = useSession();
  const topic = useMemo(() => { try { return tableTopic(ws.id, "presence"); } catch { return null; } }, [ws.id]);
  const users = usePresence(topic, { authorize: true });
  if (users.length === 0) return null;
  return <span className="hidden md:inline-flex"><PresenceFacesView users={users} max={3} /></span>;
}

export function AppShell({ children, bell }: { children: ReactNode; /** Server-rendered <BellSlot/> from the layout. */ bell?: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const { role, support, tenant } = useSession();
  const v = useVocab();
  const t = useTranslations("shell");
  const path = usePathname();
  useEffect(() => { try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1"); } catch { /* ignore */ } }, []);
  // Bare "/" and "?" (WCAG 2.1.4): ignored in form controls, editors and dialogs, and switchable off in the shortcut help.
  useSingleKeyShortcuts();
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch { /* ignore */ } return !c; });

  return (
    <div className="flex min-h-dvh">
      <a href="#main-content" className="sr-only rounded-control bg-surface px-3 py-2 text-[13px] font-medium text-ink shadow-pop outline-none focus-visible:not-sr-only focus-visible:fixed focus-visible:left-3 focus-visible:top-3 focus-visible:z-[60] focus-visible:ring-2 focus-visible:ring-ring">{t("skipToContent")}</a>
      <aside className={cn("hidden shrink-0 self-stretch bg-navy-900 transition-[width] duration-200 ease-out lg:block", collapsed ? "w-16" : "w-60")}>
        <div className="sticky top-0 flex h-dvh flex-col">
        <div className={cn("flex h-14 items-center border-b border-navy-line", collapsed ? "justify-center px-2" : "px-2.5")}><WorkspaceSwitcher collapsed={collapsed} /></div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-2 py-4"><NavList collapsed={collapsed} layoutKey="desk" /></div>
        <div className="space-y-2 border-t border-navy-line p-3">
          <DemoChip collapsed={collapsed} />
          <button onClick={toggle} className={cn("flex h-8 w-full items-center gap-2 rounded-sm px-2 text-[12px] text-navy-ink-3 hover:bg-navy-800 hover:text-navy-ink", collapsed && "justify-center")} aria-label={collapsed ? t("expandSidebar") : t("collapseSidebar")}>
            {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" />{t("collapse")}</>}
          </button>
        </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {support && <SupportBanner />}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur-[2px] sm:px-6">
          <D.Root open={open} onOpenChange={setOpen}>
            <D.Trigger className="-ml-1 rounded-sm p-1.5 text-ink-2 hover:bg-paper-2 lg:hidden" aria-label={t("openNavigation")}><MenuIcon className="size-5" /></D.Trigger>
            <D.Portal>
              <D.Overlay className="fixed inset-0 z-50 bg-navy-950/50 lg:hidden" />
              <D.Content className="fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col bg-navy-900 shadow-pop outline-none data-[state=open]:animate-[fade_150ms_ease-out] lg:hidden">
                <D.Title className="sr-only">{t("navigation")}</D.Title>
                <div className="flex h-14 items-center justify-between gap-2 border-b border-navy-line px-2.5"><div className="min-w-0 flex-1"><WorkspaceSwitcher /></div><D.Close className="rounded-sm p-1 text-navy-ink-2 hover:bg-navy-800" aria-label={t("closeNavigation")}><X className="size-5" /></D.Close></div>
                <div className="flex-1 overflow-y-auto px-2 py-4"><NavList collapsed={false} onNavigate={() => setOpen(false)} layoutKey="drawer" /></div>
                <div className="border-t border-navy-line p-3"><DemoChip /></div>
              </D.Content>
            </D.Portal>
          </D.Root>
          <div className="min-w-0 max-w-[200px] lg:hidden"><WorkspaceSwitcher onNavy={false} /></div>
          <PageTitle />
          <CommandChip />
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-chip border border-line px-2 py-1 text-[11px] text-ink-3 md:inline-flex" title={t("sampleDataTip")}>
              <Database className="size-3" aria-hidden />{t("sampleDataIst")}
            </span>
            <ShellPresence />
            <SyncStatusChip />
            {bell}
            <UserMenu />
          </div>
        </header>
        <Toaster />
        <CommandPalette />
        <ShortcutHelp />
        <main id="main-content" tabIndex={-1} key={path} className="mx-auto w-full max-w-[1400px] flex-1 scroll-mt-16 px-4 pb-24 pt-6 outline-none sm:px-6 lg:px-8 lg:pb-10">{children}</main>
      </div>

      <nav aria-label={t("quickNav")} className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-navy-line bg-navy-900 pb-[env(safe-area-inset-bottom)] lg:hidden">
        {mobileNavFor(role, tenant).slice(0, 4).map((it) => {
          const active = isActive(it.href, path);
          return (
            <Link key={it.href} href={it.href} className={cn("relative flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium", active ? "text-navy-ink" : "text-navy-ink-3")} aria-current={active ? "page" : undefined}>
              {active && <span className="absolute inset-x-5 top-0 h-0.5 rounded-b-full bg-accent-on-navy" />}
              <it.icon className={cn("size-[18px]", active && "text-accent-on-navy")} aria-hidden />
              <span className="max-w-full truncate px-1">{it.label === "Command Center" ? t("overview") : navLabel(v, it, t)}</span>
            </Link>
          );
        })}
        <button onClick={() => setOpen(true)} className="flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium text-navy-ink-3" aria-label={t("moreDestinations")}>
          <Ellipsis className="size-[18px]" aria-hidden /><span>{t("more")}</span>
        </button>
      </nav>
    </div>
  );
}
