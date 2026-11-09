import {
  Building2, CalendarClock, ChartLine, Crosshair, Database, Inbox, LayoutDashboard, ListChecks, Megaphone, MessagesSquare,
  Bell, BellRing, Boxes, KeyRound, LayoutTemplate, ListPlus, Plug, ScrollText, Settings, ShieldCheck, Webhook, SquareKanban, Users, Upload, Workflow, MailCheck, type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/data/types";
import { isModuleEnabled, moduleForPath, type Vertical, type Vocab } from "@/lib/vertical";
import { accessFor } from "@/lib/auth/roles";
import { SYSTEM_ROLES } from "@/lib/authz/catalog/system-roles";
import { iconFor } from "@/lib/layouts/icons";

export type NavItem = { href: string; label: string; icon: LucideIcon; badge?: string; /** Extra permission the role must hold (same key the route asserts). Hidden when missing. */ perm?: string; /** Not in the legacy page matrix: shown on `perm` alone. */ permOnly?: boolean };
export const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Overview", items: [{ href: "/", label: "Command Center", icon: LayoutDashboard }, { href: "/sales", label: "My day", icon: CalendarClock }, { href: "/notifications", label: "Notifications", icon: Bell }] },
  { group: "Sell", items: [
    { href: "/leads", label: "Leads", icon: Users }, { href: "/import", label: "Import", icon: Upload, perm: "leads.import", permOnly: true }, { href: "/pipeline", label: "Pipeline", icon: SquareKanban },
    { href: "/accounts", label: "Law firms", icon: Building2 }, { href: "/inbox", label: "Inbox", icon: Inbox, badge: "Showcase" }, { href: "/tasks", label: "Tasks", icon: ListChecks },
  ] },
  { group: "Market", items: [{ href: "/campaigns", label: "Campaigns", icon: Megaphone }, { href: "/audience", label: "Audience", icon: Crosshair }, { href: "/analytics", label: "Web analytics", icon: ChartLine }] },
  { group: "Assist", items: [{ href: "/ai", label: "Copilot", icon: MessagesSquare }] },
  { group: "Admin", items: [{ href: "/integrations", label: "Integrations", icon: Plug }, { href: "/data-health", label: "Data health", icon: Database }, { href: "/settings", label: "Settings", icon: Settings },
    { href: "/settings/notifications", label: "Notification settings", icon: BellRing },
    { href: "/settings/roles", label: "Roles & access", icon: ShieldCheck, perm: "members.manage" },
    { href: "/settings/audit", label: "Audit log", icon: ScrollText, perm: "audit.read" },
    { href: "/settings/api-keys", label: "API keys", icon: KeyRound, perm: "api_keys.manage" },
    { href: "/settings/webhooks", label: "Webhooks", icon: Webhook, perm: "webhooks.manage" },
    { href: "/settings/pipelines", label: "Pipelines", icon: Workflow, perm: "pipelines.manage" },
    { href: "/settings/email", label: "Email sending", icon: MailCheck, perm: "integrations.manage" },
    { href: "/settings/fields", label: "Custom fields", icon: ListPlus, perm: "fields.manage" },
    { href: "/settings/objects", label: "Custom objects", icon: Boxes, perm: "objects.manage" },
    { href: "/settings/layouts", label: "Layouts", icon: LayoutTemplate, perm: "layouts.manage" }] },
];

/** An enabled custom object the viewer may read, resolved on the server (label already in the viewer's language, icon from the allow-list). */
export type NavObject = { key: string; label: string; icon: string };
export const OBJECTS_GROUP = "Records";
const holds = (role: Role, perm?: string) => !perm || !!SYSTEM_ROLES.find((r) => r.key === role)?.grants[perm];
export const navFor = (role: Role, tenant?: { id?: string; vertical?: Vertical }, objects: NavObject[] = []) => {
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => (i.permOnly || accessFor(role, i.href)) && holds(role, i.perm) && (!tenant || !moduleForPath(i.href) || isModuleEnabled(tenant, moduleForPath(i.href)!))) })).filter((g) => g.items.length);
  // Custom objects were filtered on the server by obj:<key>.read; they sit between the work groups and Admin.
  if (!objects.length) return groups;
  const group = { group: OBJECTS_GROUP, items: objects.map((o): NavItem => ({ href: `/o/${o.key}`, label: o.label, icon: iconFor(o.icon) })) };
  const at = groups.findIndex((g) => g.group === "Admin");
  return at < 0 ? [...groups, group] : [...groups.slice(0, at), group, ...groups.slice(at)];
};
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
