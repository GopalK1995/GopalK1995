// View models for the real (non-demo) integrations screens. Plain data only: nothing here can carry a secret.
import type { ChipState } from "@/lib/connectors/core/status";

export interface ConnectorRowView {
  id: string; name: string; category: string; chip: ChipState; blockKey: string | null;
  mode: "sandbox" | "live" | null; connectionId: string | null; lastSyncAt: string | null; lastError: string | null; registered: boolean;
}
export interface RunView {
  id: number; startedAt: string; stream: string | null; kind: string; status: string; rowsIn: number; rowsOut: number; rowsRejected: number; error: string | null;
}
export interface MapRowView {
  externalObject: string; externalField: string; localTable: string; localColumn: string; direction: "in" | "out" | "both";
  transform: string | null; transformArg: string; sample: string; custom: boolean;
}
/** One-line Meta connection health (AUD-036). Dates and names only. */
export interface MetaHealthView {
  scopesGranted: number | null; scopesRequested: number; scopesMissing: string[];
  /** names for the connect step list: what Meta granted and what we asked for */
  scopesGrantedList: string[]; scopesRequestedList: string[];
  expiresAt: string | null; neverExpires: boolean; daysLeft: number | null;
  webhook: "yes" | "no" | "unknown"; lastOkAt: string | null; attention: boolean;
}
/** What the connect step list needs beyond the health line: chosen Page/Instagram names and sync counts. Names and numbers only. */
export interface MetaConnectView {
  /** a connection with credentials exists (connected, needs attention or error) */
  connected: boolean; needsReconnect: boolean; connectionId: string | null;
  pageName: string | null; igUsername: string | null;
  accounts: number; posts: number; lastOkRows: number | null;
}
export interface DetailView {
  row: ConnectorRowView; auth: string; authKind: "oauth2" | "api_key" | "service_account" | "webhook_secret" | "none";
  fields: { key: string; label: string; secret: boolean }[]; sandboxSupported: boolean; sandboxHowTo: string | null;
  steps: string[]; flows: { object: string; dir: "in" | "out" }[]; runs: RunView[]; map: MapRowView[]; editable: boolean; accountLabel: string | null;
  oauthReady: boolean;
  metaHealth: MetaHealthView | null;
  metaConnect: MetaConnectView | null;
}
export const MAP_TABLES = ["leads", "contacts", "accounts", "deals"] as const;
