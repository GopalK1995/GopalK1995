// Multi-tenant model (mock). Mirrors BACKEND tables: tenants, workspaces, memberships, platform_admins, support_sessions,
// and RPCs my_workspaces(), create_workspace(), invite_member(), admin_create_tenant(), start_support_session(), end_support_session().
// TENANT = white-label client org (brand). WORKSPACE = isolated data area inside a tenant. ROLE is per workspace membership.
// Pure data, no Node APIs: imported by middleware (edge) too.
import type { Role } from "./data/types";

export interface Tenant {
  id: string; name: string; product: string; hue: number; monogram: string;
  plan: "Growth" | "Scale" | "Pilot"; seats: number; primaryOwnerId: string; status: "active" | "suspended" | "trial"; createdAt: string; supportEmail: string;
}
export interface Workspace { id: string; tenantId: string; name: string; region: string; createdAt: string; dataset: "tn" | "kerala" | "kaveri" }
export interface PlatformUser { id: string; name: string; email: string; platformAdmin?: boolean; lastSignIn: string; status: "active" | "invited" | "deactivated" }
export interface Membership { userId: string; workspaceId: string; role: Role }

export const TENANTS: Tenant[] = [
  { id: "lawsome", name: "LAWSOME", product: "Growth CRM", hue: 245, monogram: "L", plan: "Growth", seats: 12, primaryOwnerId: "u-meenakshi", status: "active", createdAt: "2026-06-02", supportEmail: "support@lawsome.example" },
  { id: "kaveri-demo", name: "Kaveri LegalTech (demo)", product: "Sales Desk", hue: 165, monogram: "K", plan: "Pilot", seats: 4, primaryOwnerId: "u-lavanya", status: "trial", createdAt: "2026-09-21", supportEmail: "help@kaverilegal.example" },
];
export const WORKSPACES: Workspace[] = [
  { id: "lawsome-tn", tenantId: "lawsome", name: "Tamil Nadu", region: "Chennai · Coimbatore · Madurai · Trichy · Salem · Tirunelveli", createdAt: "2026-06-02", dataset: "tn" },
  { id: "lawsome-kl", tenantId: "lawsome", name: "Kerala pilot", region: "Ernakulam · Thiruvananthapuram · Kozhikode · Thrissur", createdAt: "2026-09-08", dataset: "kerala" },
  { id: "kaveri-cbe", tenantId: "kaveri-demo", name: "Coimbatore", region: "Coimbatore · Tiruppur", createdAt: "2026-09-21", dataset: "kaveri" },
];
export const USERS: PlatformUser[] = [
  { id: "u-vikram", name: "Vikram Anand", email: "vikram@synthan.example", platformAdmin: true, lastSignIn: "2026-10-13T03:40:00.000Z", status: "active" },
  { id: "u-meenakshi", name: "Meenakshi Sundaram", email: "meenakshi@lawsome.example", lastSignIn: "2026-10-13T03:05:00.000Z", status: "active" },
  { id: "u-priya", name: "Priya Raman", email: "priya@lawsome.example", lastSignIn: "2026-10-13T04:12:00.000Z", status: "active" },
  { id: "u-arun", name: "Arun Kumar", email: "arun@lawsome.example", lastSignIn: "2026-10-13T04:31:00.000Z", status: "active" },
  { id: "u-divya", name: "Divya Sekar", email: "divya@lawsome.example", lastSignIn: "2026-10-12T13:20:00.000Z", status: "active" },
  { id: "u-karthik", name: "Karthik Raja", email: "karthik@lawsome.example", lastSignIn: "2026-10-12T15:02:00.000Z", status: "active" },
  { id: "u-nithya", name: "Nithya Balan", email: "nithya@lawsome.example", lastSignIn: "2026-10-13T02:58:00.000Z", status: "active" },
  { id: "u-sanjay", name: "Sanjay Iyer", email: "sanjay@lawsome.example", lastSignIn: "2026-10-11T09:44:00.000Z", status: "active" },
  { id: "u-rahul", name: "Rahul Varma", email: "rahul@lawsome.example", lastSignIn: "2026-10-02T07:15:00.000Z", status: "active" },
  { id: "u-anoop", name: "Anoop Mathew", email: "anoop@lawsome.example", lastSignIn: "2026-10-12T11:10:00.000Z", status: "active" },
  { id: "u-lavanya", name: "Lavanya Prakash", email: "lavanya@kaverilegal.example", lastSignIn: "2026-10-12T16:45:00.000Z", status: "active" },
  { id: "u-suresh", name: "Suresh Babu", email: "suresh@kaverilegal.example", lastSignIn: "2026-10-10T10:00:00.000Z", status: "invited" },
];
export const MEMBERSHIPS: Membership[] = [
  { userId: "u-meenakshi", workspaceId: "lawsome-tn", role: "owner" },
  { userId: "u-meenakshi", workspaceId: "lawsome-kl", role: "owner" },
  { userId: "u-priya", workspaceId: "lawsome-tn", role: "sales_manager" },
  { userId: "u-arun", workspaceId: "lawsome-tn", role: "sales_rep" },
  { userId: "u-arun", workspaceId: "lawsome-kl", role: "viewer" },
  { userId: "u-divya", workspaceId: "lawsome-tn", role: "sales_rep" },
  { userId: "u-karthik", workspaceId: "lawsome-tn", role: "sales_rep" },
  { userId: "u-nithya", workspaceId: "lawsome-tn", role: "marketing" },
  { userId: "u-nithya", workspaceId: "lawsome-kl", role: "marketing" },
  { userId: "u-sanjay", workspaceId: "lawsome-tn", role: "data" },
  { userId: "u-rahul", workspaceId: "lawsome-tn", role: "viewer" },
  { userId: "u-anoop", workspaceId: "lawsome-kl", role: "sales_rep" },
  { userId: "u-lavanya", workspaceId: "kaveri-cbe", role: "owner" },
  { userId: "u-suresh", workspaceId: "kaveri-cbe", role: "sales_rep" },
];

/** Demo personas shown on /login. */
export const PERSONAS: { key: string; userId: string; label: string; detail: string; secondary?: boolean }[] = [
  { key: "owner-lawsome", userId: "u-meenakshi", label: "Owner — LAWSOME", detail: "Revenue, pipeline, team, branding. Owner in Tamil Nadu and Kerala pilot." },
  { key: "mgr-lawsome", userId: "u-priya", label: "Sales Manager — LAWSOME TN", detail: "Team pipeline, assignment, targets and SLAs." },
  { key: "rep-lawsome", userId: "u-arun", label: "Sales Rep — LAWSOME TN", detail: "Own leads, demos and follow-ups. Also Viewer in the Kerala pilot." },
  { key: "mkt-lawsome", userId: "u-nithya", label: "Marketing — LAWSOME", detail: "Campaigns, audience, web analytics. Both LAWSOME workspaces." },
  { key: "owner-kaveri", userId: "u-lavanya", label: "Owner — Kaveri LegalTech", detail: "A second white-label tenant with its own brand and data." },
  { key: "super", userId: "u-vikram", label: "Super admin (Synthan)", detail: "Platform operator: tenants, workspaces, users, audit. No business data without a support session." },
  { key: "data-lawsome", userId: "u-sanjay", label: "Data — LAWSOME TN", detail: "Imports, integrations, backups.", secondary: true },
  { key: "viewer-lawsome", userId: "u-rahul", label: "Viewer — LAWSOME TN", detail: "Read-only, masked personal data.", secondary: true },
];

export const tenantOf = (wsId: string) => TENANTS.find((t) => t.id === WORKSPACES.find((w) => w.id === wsId)?.tenantId);
export const workspaceById = (id: string) => WORKSPACES.find((w) => w.id === id);
export const membershipsFor = (userId: string) => MEMBERSHIPS.filter((m) => m.userId === userId);
export const userById = (id: string) => USERS.find((u) => u.id === id);
