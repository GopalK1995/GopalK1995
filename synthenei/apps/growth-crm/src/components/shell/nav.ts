import {
  Building2, CalendarClock, ChartLine, Crosshair, Database, Inbox, LayoutDashboard, ListChecks, Megaphone, MessagesSquare,
  Plug, Settings, SquareKanban, Users, type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/data/types";
import { accessFor } from "@/lib/auth/roles";

export type NavItem = { href: string; label: string; icon: LucideIcon; badge?: string };
export const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Overview", items: [{ href: "/", label: "Command Center", icon: LayoutDashboard }, { href: "/sales", label: "My day", icon: CalendarClock }] },
  { group: "Sell", items: [
    { href: "/leads", label: "Leads", icon: Users }, { href: "/pipeline", label: "Pipeline", icon: SquareKanban },
    { href: "/accounts", label: "Law firms", icon: Building2 }, { href: "/inbox", label: "Inbox", icon: Inbox, badge: "Showcase" }, { href: "/tasks", label: "Tasks", icon: ListChecks },
  ] },
  { group: "Market", items: [{ href: "/campaigns", label: "Campaigns", icon: Megaphone }, { href: "/audience", label: "Audience", icon: Crosshair }, { href: "/analytics", label: "Web analytics", icon: ChartLine }] },
  { group: "Assist", items: [{ href: "/ai", label: "Copilot", icon: MessagesSquare }] },
  { group: "Admin", items: [{ href: "/integrations", label: "Integrations", icon: Plug }, { href: "/data-health", label: "Data health", icon: Database }, { href: "/settings", label: "Settings", icon: Settings }] },
];
export const navFor = (role: Role) => NAV.map((g) => ({ ...g, items: g.items.filter((i) => accessFor(role, i.href)) })).filter((g) => g.items.length);
/** Five bottom-bar items per role on mobile. */
const MOBILE: Record<Role, string[]> = {
  owner: ["/", "/pipeline", "/leads", "/campaigns", "/settings"],
  sales_manager: ["/", "/pipeline", "/leads", "/tasks", "/sales"],
  sales_rep: ["/sales", "/leads", "/pipeline", "/inbox", "/tasks"],
  marketing: ["/campaigns", "/audience", "/analytics", "/leads", "/integrations"],
  data: ["/data-health", "/integrations", "/leads", "/accounts", "/settings"],
  viewer: ["/", "/pipeline", "/campaigns", "/analytics", "/accounts"],
};
export const mobileNavFor = (role: Role) => MOBILE[role].map((h) => NAV.flatMap((g) => g.items).find((i) => i.href === h)!).filter(Boolean);
export const isActive = (href: string, path: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
