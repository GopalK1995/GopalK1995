// One designed empty state per module, for a zero-data workspace. Pure data: `module-empty.tsx` renders it.
import { Boxes, Building2, ChartLine, Crosshair, Database, Inbox, ListChecks, Megaphone, MessagesSquare, Plug, SquareKanban, Users } from "lucide-react";
import type { ModuleEmptyDef } from "./module-empty";

export const LEADS_EMPTY: ModuleEmptyDef = { icon: Users, title: "No leads yet", body: "Leads come in from your landing page, connected channels, or a CSV you import.", cta: "Import leads", href: "/import" };
export const PIPELINE_EMPTY: ModuleEmptyDef = { icon: SquareKanban, title: "The pipeline is empty", body: "Add a lead or import a list, then move deals through your stages as they progress.", cta: "Add a lead", href: "/leads" };
export const ACCOUNTS_EMPTY: ModuleEmptyDef = { icon: Building2, title: "No accounts yet", body: "Accounts group contacts and deals under one organisation.", cta: "Go to leads", href: "/leads" };
export const CAMPAIGNS_EMPTY: ModuleEmptyDef = { icon: Megaphone, title: "No campaigns yet", body: "Track spend and results per campaign once you start running one.", cta: "Create a campaign", href: "/campaigns" };
export const AUDIENCE_EMPTY: ModuleEmptyDef = { icon: Crosshair, title: "No audience segments yet", body: "Segment leads and contacts to target campaigns and exports.", cta: "Go to leads", href: "/leads" };
export const ANALYTICS_EMPTY: ModuleEmptyDef = { icon: ChartLine, title: "Nothing to show yet", body: "Charts fill in once leads, campaigns and web traffic start flowing.", cta: "Connect an integration", href: "/integrations" };
export const INBOX_EMPTY: ModuleEmptyDef = { icon: Inbox, title: "Inbox is empty", body: "Connect WhatsApp, email or another channel to see conversations here.", cta: "Connect an integration", href: "/integrations" };
export const TASKS_EMPTY: ModuleEmptyDef = { icon: ListChecks, title: "No tasks yet", body: "Tasks follow up on leads and deals -- add one, or they'll appear as you work records.", cta: "Go to leads", href: "/leads" };
export const INTEGRATIONS_EMPTY: ModuleEmptyDef = { icon: Plug, title: "Nothing connected yet", body: "Connect WhatsApp, email, ads or your calendar to start syncing data automatically.", cta: "Browse integrations", href: "/integrations" };
export const DATA_HEALTH_EMPTY: ModuleEmptyDef = { icon: Database, title: "No checks recorded yet", body: "The first nightly heartbeat and alert rules appear here once the workspace has run for a day.", cta: "Run a check now", href: "/data-health" };
export const AI_EMPTY: ModuleEmptyDef = { icon: MessagesSquare, title: "Ask Copilot anything", body: "Summaries and next-best-actions need a few leads or deals to work with first.", cta: "Go to leads", href: "/leads" };
export const OBJECTS_EMPTY: ModuleEmptyDef = { icon: Boxes, title: "No records yet", body: "This custom object has no records yet.", cta: "Go to Settings", href: "/settings/objects" };
