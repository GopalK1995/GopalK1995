"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Building2, ChevronDown, Gauge, LifeBuoy, LogOut, ScrollText, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { endSupport, logout } from "@/lib/auth/actions";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSep, MenuTrigger } from "@/components/ui/dropdown";
import { Toaster } from "@/components/ui/toast";

const NAV = [
  { href: "/admin", label: "Overview", icon: Gauge },
  { href: "/admin/tenants", label: "Tenants", icon: Building2 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/support", label: "Support sessions", icon: LifeBuoy },
];
const isOn = (href: string, path: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(href + "/"));

export type ShellSupport = { wsLabel: string; mode: "read_only" | "read_write"; endsAtLabel: string } | null;

export function AdminShell({ name, email, demo, support, children }: { name: string; email: string; demo: boolean; support: ShellSupport; children: ReactNode }) {
  const path = usePathname();
  const reduce = useReducedMotion();
  // The console is never tenant-branded: pin the platform hue even if a tenant hue was applied earlier in this tab.
  useEffect(() => { document.documentElement.style.setProperty("--brand-h", "245"); }, []);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-navy-950 text-navy-ink">
        <div className="mx-auto flex h-12 max-w-[1400px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link href="/admin" className="flex min-w-0 items-center gap-2 rounded-sm text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ShieldCheck className="size-4 shrink-0 text-accent-on-navy" aria-hidden />
            <span className="truncate font-semibold">Platform admin</span>
            <span className="hidden text-navy-ink-3 sm:inline">· Synthan</span>
          </Link>
          {demo && <span className="hidden rounded-[3px] border border-navy-line px-1.5 py-0.5 text-[11px] text-navy-ink-3 md:inline">Demo · MFA simulated · nothing persists</span>}
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {support && (
              <form action={endSupport} className="flex min-w-0 items-center gap-2 rounded-sm bg-warn-soft py-1 pl-2 pr-1 text-[12px] text-warn-ink">
                <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
                <span className="hidden truncate sm:inline">Support open: {support.wsLabel} · {support.mode === "read_only" ? "read-only" : "read-write"} · ends {support.endsAtLabel} IST</span>
                <span className="sm:hidden">Support open</span>
                <button className="h-6 shrink-0 rounded-[4px] border border-warn/50 bg-surface px-2 font-medium hover:bg-warn-soft">End</button>
              </form>
            )}
            <Menu>
              <MenuTrigger className="flex shrink-0 items-center gap-2 rounded-sm py-1 pl-1 pr-1.5 outline-none hover:bg-navy-800 focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu">
                <Avatar name={name} size={26} className="bg-navy-800 text-navy-ink" />
                <span className="hidden text-[12px] font-medium md:block">{name}</span>
                <ChevronDown className="hidden size-3.5 text-navy-ink-3 md:block" aria-hidden />
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Signed in to the platform console</MenuLabel>
                <div className="px-2 pb-2 text-[12px]"><div className="font-medium text-ink">{name}</div><div className="text-ink-3">{email} · Super admin</div></div>
                <MenuSep />
                <MenuItem onSelect={() => { void logout(); }}><LogOut />Log out of platform console</MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>
      </header>
      <nav aria-label="Platform admin" className="border-b border-line bg-surface">
        <ul className="scrollbar-thin mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-2 sm:px-4 lg:px-6">
          {NAV.map((it) => {
            const on = isOn(it.href, path);
            return (
              <li key={it.href} className="shrink-0">
                <Link href={it.href} aria-current={on ? "page" : undefined}
                  className={cn("relative flex h-11 items-center gap-2 px-3 text-[13px] font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring", on ? "text-ink" : "text-ink-3 hover:text-ink")}>
                  <it.icon className={cn("size-4", on ? "text-accent" : "text-ink-3")} aria-hidden />{it.label}
                  {on && <motion.span layoutId="admin-nav" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" transition={reduce ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }} />}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <Toaster />
      <main className="mx-auto w-full min-w-0 max-w-[1400px] flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
