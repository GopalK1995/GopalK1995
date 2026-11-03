import {
  Building2, CalendarClock, ChartLine, Crosshair, Database, Inbox, LayoutDashboard, ListChecks, Megaphone, MessagesSquare,
  Bell, BellRing, KeyRound, Plug, ScrollText, Settings, ShieldCheck, SquareKanban, Users, type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/data/types";
import { isModuleEnabled, moduleForPath, type Vertical, type Vocab } from "@/lib/vertical";
import { accessFor } from "@/lib/auth/roles";
import { SYSTEM_ROLES } from "@/lib/authz/catalog/system-roles";

export type NavItem = { href: string; label: string; icon: LucideIcon; badge?: string; /** Extra permission the role must hold (same key the route asserts). Hidden when missing. */ perm?: string };
export const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Overview", items: [{ href: "/", label: "Command Center", icon: LayoutDashboard }, { href: "/sales", label: "My day", icon: CalendarClock }, { href: "/notifications", label: "Notifications", icon: Bell }] },
  { group: "Sell", items: [
    { href: "/leads", label: "Leads", icon: Users }, { href: "/pipeline", label: "Pipeline", icon: SquareKanban },
    { href: "/accounts", label: "Law firms", icon: Building2 }, { href: "/inbox", label: "Inbox", icon: Inbox, badge: "Showcase" }, { href: "/tasks", label: "Tasks", icon: ListChecks },
  ] },
  { group: "Market", items: [{ href: "/campaigns", label: "Campaigns", icon: Megaphone }, { href: "/audience", label: "Audience", icon: Crosshair }, { href: "/analytics", label: "Web analytics", icon: ChartLine }] },
  { group: "Assist", items: [{ href: "/ai", label: "Copilot", icon: MessagesSquare }] },
  { group: "Admin", items: [{ href: "/integrations", label: "Integrations", icon: Plug }, { href: "/data-health", label: "Data health", icon: Database }, { href: "/settings", label: "Settings", icon: Settings },
    { href: "/settings/notifications", label: "Notification settings", icon: BellRing },
    { href: "/settings/roles", label: "Roles & access", icon: ShieldCheck, perm: "members.manage" },
    { href: "/settings/audit", label: "Audit log", icon: ScrollText, perm: "audit.read" },
    { href: "/settings/api-keys", label: "API keys", icon: KeyRound, perm: "api_keys.manage" }] },
];
const holds = (role: Role, perm?: string) => !perm || !!SYSTEM_ROLES.find((r) => r.key === role)?.grants[perm];
export const navFor = (role: Role, tenant?: { id?: string; vertical?: Vertical }) => NAV.map((g) => ({ ...g, items: g.items.filter((i) => accessFor(role, i.href) && holds(role, i.perm) && (!tenant || !moduleForPath(i.href) || isModuleEnabled(tenant, moduleForPath(i.href)!))) })).filter((g) => g.items.length);
/** Five bottom-bar items per role on mobile. */
const MOBILE: Record<Role, string[]> = {
  owner: ["/", "/pipeline", "/leads", "/campaigns", "/settings"],
  sales_manager: ["/", "/pipeline", "/leads", "/tasks", "/sales"],
  sales_rep: ["/sales", "/leads", "/pipeline", "/inbox", "/tasks"],
  marketing: ["/campaigns", "/audience", "/analytics", "/leads", "/integrations"],
  data: ["/data-health", "/integrations", "/leads", "/accounts", "/settings"],
  viewer: ["/", "/pipeline", "/campaigns", "/analytics", "/accounts"],
};
export const mobileNavFor = (role: Role, tenant?: { id?: string; vertical?: Vertical }) => MOBILE[role].filter((h) => !tenant || !moduleForPath(h) || isModuleEnabled(tenant, moduleForPath(h)!)).map((h) => NAV.flatMap((g) => g.items).find((i) => i.href === h)!).filter(Boolean);
export const isActive = (href: string, path: string) => (href === "/" || href === "/settings" ? path === href : path === href || path.startsWith(href + "/"));

/** Vocabulary-aware nav label (legal output is unchanged). */
export const navLabel = (v: Vocab, it: NavItem) => (it.href === "/leads" ? v.nav.leads : it.href === "/accounts" ? v.nav.accounts : it.label);
export const navGroup = (v: Vocab, g: string) => (g === "Sell" ? v.nav.sell : g);
