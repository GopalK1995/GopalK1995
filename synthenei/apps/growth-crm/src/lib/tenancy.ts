// Multi-tenant model (mock). Mirrors BACKEND tables: tenants, workspaces, memberships, platform_admins, support_sessions,
// and RPCs my_workspaces(), create_workspace(), invite_member(), admin_create_tenant(), start_support_session(), end_support_session().
// TENANT = white-label client org (brand). WORKSPACE = isolated data area inside a tenant. ROLE is per workspace membership.
// Pure data, no Node APIs: imported by middleware (edge) too.
import type { Role } from "./data/types";
import type { TenantConfigOverrides } from "./vertical";

export interface Tenant {
  id: string; name: string; product: string; hue: number; monogram: string;
  plan: "Growth" | "Scale" | "Pilot"; seats: number; primaryOwnerId: string; status: "active" | "suspended" | "trial"; createdAt: string; supportEmail: string;
  /** Industry vocabulary set. Absent = legal. */ vertical?: "legal" | "hospitality";
  /** Effective tenant config for this request (attached by requireActive; never stored on the static record). */ config?: TenantConfigOverrides;
}
export interface Workspace { id: string; /** DB uuid (BACKEND demo seed) */ uuid: string; tenantId: string; name: string; region: string; createdAt: string; dataset: "tn" | "kerala" | "kaveri" | "wg" }
export interface PlatformUser { id: string; name: string; email: string; platformAdmin?: boolean; lastSignIn: string; status: "active" | "invited" | "deactivated" }
export interface Membership { userId: string; workspaceId: string; role: Role }

export const TENANTS: Tenant[] = [
  { id: "lawsome", name: "LAWSOME", product: "Growth CRM", hue: 245, monogram: "L", plan: "Growth", seats: 12, primaryOwnerId: "u-meenakshi", status: "active", createdAt: "2026-06-02", supportEmail: "support@lawsome.example", vertical: "legal" },
  { id: "kaveri-demo", name: "Kaveri LegalTech (demo)", product: "Sales Desk", hue: 178, monogram: "K", plan: "Pilot", seats: 4, primaryOwnerId: "u-lavanya", status: "trial", createdAt: "2026-09-21", supportEmail: "help@kaverilegal.example", vertical: "legal" },
  { id: "shola-mist", name: "Shola Mist Guesthouse", product: "Stay CRM", hue: 152, monogram: "S", plan: "Growth", seats: 4, status: "active", createdAt: "2026-09-30", supportEmail: "stay@sholamist.example", primaryOwnerId: "u-kavitha", vertical: "hospitality" },
];
export const WORKSPACES: Workspace[] = [
  { id: "lawsome-tn", uuid: "20000000-0000-4000-8000-000000000001", tenantId: "lawsome", name: "Tamil Nadu", region: "Chennai · Coimbatore · Madurai · Trichy · Salem · Tirunelveli", createdAt: "2026-06-02", dataset: "tn" },
  { id: "lawsome-kl", uuid: "20000000-0000-4000-8000-000000000002", tenantId: "lawsome", name: "Kerala pilot", region: "Ernakulam · Thiruvananthapuram · Kozhikode · Thrissur", createdAt: "2026-09-08", dataset: "kerala" },
  { id: "kaveri-cbe", uuid: "20000000-0000-4000-8000-000000000003", tenantId: "kaveri-demo", name: "Coimbatore", region: "Coimbatore · Tiruppur", createdAt: "2026-09-21", dataset: "kaveri" },
  { id: "shola-mist-coonoor", uuid: "20000000-0000-4000-8000-000000000004", tenantId: "shola-mist", name: "Coonoor", region: "Coonoor · Ooty · Kotagiri · Kodaikanal circuit", createdAt: "2026-09-30", dataset: "wg" },
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
  { id: "u-kavitha", name: "Kavitha Ramesh", email: "kavitha@sholamist.example", lastSignIn: "2026-10-13T03:20:00.000Z", status: "active" },
  { id: "u-bala", name: "Balamurugan S.", email: "bala@sholamist.example", lastSignIn: "2026-10-13T04:05:00.000Z", status: "active" },
  { id: "u-sneha", name: "Sneha Joseph", email: "sneha@sholamist.example", lastSignIn: "2026-10-12T12:30:00.000Z", status: "active" },
  { id: "u-rameshi", name: "Ramesh Iyer", email: "ramesh@sholamist.example", lastSignIn: "2026-10-11T08:15:00.000Z", status: "active" },
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
  { userId: "u-nithya", workspaceId: "kaveri-cbe", role: "viewer" },
  { userId: "u-sanjay", workspaceId: "lawsome-tn", role: "data" },
  { userId: "u-rahul", workspaceId: "lawsome-tn", role: "viewer" },
  { userId: "u-anoop", workspaceId: "lawsome-kl", role: "sales_rep" },
  { userId: "u-lavanya", workspaceId: "kaveri-cbe", role: "owner" },
  { userId: "u-suresh", workspaceId: "kaveri-cbe", role: "sales_rep" },
  { userId: "u-kavitha", workspaceId: "shola-mist-coonoor", role: "owner" },
  { userId: "u-bala", workspaceId: "shola-mist-coonoor", role: "sales_rep" },
  { userId: "u-sneha", workspaceId: "shola-mist-coonoor", role: "marketing" },
  { userId: "u-rameshi", workspaceId: "shola-mist-coonoor", role: "viewer" },
];

/** Demo personas shown on /login. */
export const PERSONAS: { key: string; userId: string; label: string; detail: string; secondary?: boolean; /** Tenant the persona belongs to (absent = platform super admin). */ tenantId?: string }[] = [
  { key: "owner-lawsome", userId: "u-meenakshi", label: "Owner · LAWSOME", detail: "Revenue, pipeline, team, branding. Owner in Tamil Nadu and Kerala pilot.", tenantId: "lawsome" },
  { key: "mgr-lawsome", userId: "u-priya", label: "Sales Manager · TN", detail: "Team pipeline, assignment, targets and SLAs.", tenantId: "lawsome" },
  { key: "rep-lawsome", userId: "u-arun", label: "Sales Rep · TN", detail: "Own leads, demos and follow-ups. Also Viewer in the Kerala pilot.", tenantId: "lawsome" },
  { key: "mkt-lawsome", userId: "u-nithya", label: "Marketing · LAWSOME", detail: "Campaigns, audience, analytics in both LAWSOME workspaces; Viewer at Kaveri LegalTech (two tenants).", tenantId: "lawsome" },
  { key: "owner-kaveri", userId: "u-lavanya", label: "Owner · Kaveri LegalTech", detail: "A second white-label tenant with its own brand and data.", tenantId: "kaveri-demo" },
  { key: "super", userId: "u-vikram", label: "Super admin · Synthan", detail: "Platform operator: tenants, workspaces, users, audit. No business data without a support session." },
  { key: "data-lawsome", userId: "u-sanjay", label: "Data · TN", detail: "Imports, integrations, backups.", secondary: true, tenantId: "lawsome" },
  { key: "viewer-lawsome", userId: "u-rahul", label: "Viewer · TN", detail: "Read-only, masked personal data.", secondary: true, tenantId: "lawsome" },
  { key: "owner-shola", userId: "u-kavitha", label: "Owner · Shola Mist", detail: "Bookings, revenue, campaign payback and brand for the guesthouse.", tenantId: "shola-mist" },
  { key: "rep-shola", userId: "u-bala", label: "Reservations · Shola Mist", detail: "Replies on WhatsApp and phone, sends quotes, confirms advances.", tenantId: "shola-mist" },
  { key: "mkt-shola", userId: "u-sneha", label: "Marketing · Shola Mist", detail: "Instagram and Meta, WhatsApp broadcasts, Google profile, travel-agent partners.", tenantId: "shola-mist" },
  { key: "viewer-shola", userId: "u-rameshi", label: "Viewer · Shola Mist", detail: "Read-only view of enquiries and bookings, guest details masked.", secondary: true, tenantId: "shola-mist" },
];

/** Accepts the slug id or the DB uuid (real sessions get uuids from my_workspaces()). */
export const workspaceById = (id: string) => WORKSPACES.find((w) => w.id === id || w.uuid === id);
export const tenantOf = (wsId: string) => TENANTS.find((t) => t.id === workspaceById(wsId)?.tenantId);
export const membershipsFor = (userId: string) => MEMBERSHIPS.filter((m) => m.userId === userId);
export const userById = (id: string) => USERS.find((u) => u.id === id);
