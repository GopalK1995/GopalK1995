// Row and input types derived from the generated Database type, camelCased.
// `version` is added by migration 0014 and is not in supabase/types.ts until the integrator regenerates it.
import type { Database } from "../../../../supabase/types";
import type { Camelize } from "../map";

type Tbl = Database["public"]["Tables"];
export type TableName = keyof Tbl;

type ServerField = "id" | "tenantId" | "workspaceId" | "createdAt" | "updatedAt" | "deletedAt" | "version";

export type RowOf<T extends TableName> = Camelize<Tbl[T]["Row"]>;
export type VersionedRowOf<T extends TableName> = RowOf<T> & { version: number };
export type InputOf<T extends TableName> = Omit<Camelize<Tbl[T]["Insert"]>, ServerField>;

export type Lead = VersionedRowOf<"leads">;
export type LeadInput = InputOf<"leads">;
export type Account = VersionedRowOf<"accounts">;
export type AccountInput = InputOf<"accounts">;
export type Contact = VersionedRowOf<"contacts">;
export type ContactInput = InputOf<"contacts">;
export type Deal = VersionedRowOf<"deals">;
export type DealInput = InputOf<"deals">;
export type TaskRow = VersionedRowOf<"tasks">;
export type TaskInput = InputOf<"tasks">;
export type ActivityRow = RowOf<"activities">;
export type ActivityInput = InputOf<"activities">;
export type CampaignRow = VersionedRowOf<"campaigns">;
export type CampaignInput = InputOf<"campaigns">;
export type ConversationRow = VersionedRowOf<"conversations">;
export type ConversationInput = InputOf<"conversations">;
export type MessageRow = RowOf<"messages">;
export type MessageInput = InputOf<"messages">;
export type IntegrationRow = RowOf<"integrations">;
export type IntegrationInput = InputOf<"integrations">;
export type AuditRow = RowOf<"audit_log">;
