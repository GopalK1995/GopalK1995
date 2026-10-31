// Status truthfulness (BUILD-PLAN 1.7): the chip a user sees is derived, never stored. "Connected" is only ever shown when
// credentials exist AND the platform availability gate says live AND the connection itself is live. Pure.
import type { ConnMode, IntegrationStatus } from "./types";

export type AvailabilityRow = { mode: "disabled" | "sandbox" | "live"; gateStatus: "needs_vendor_approval" | "needs_client_credentials" | "ready"; note?: string | null };
export type ConnectionFacts = { status: IntegrationStatus; mode: ConnMode; hasCredentials: boolean };

export type ChipState =
  | "not_available"          // platform has it disabled (or no availability row)
  | "needs_vendor_approval"  // gate not cleared, nothing connectable yet
  | "needs_client_credentials"
  | "not_configured"         // Synthan has not set the vendor app up (env missing)
  | "available"              // can be connected, no connection yet
  | "sandbox"
  | "needs_attention"
  | "error"
  | "disconnected"
  | "connected";

export interface ChipInput { availability: AvailabilityRow | null; connection: ConnectionFacts | null; envConfigured: boolean }
export interface ChipResult { state: ChipState; /** Why the connect action is disabled, as an i18n key suffix; null when it is allowed. */ blockReason: "not_available" | "needs_vendor_approval" | "needs_client_credentials" | "not_configured" | null }

export function deriveChip({ availability, connection, envConfigured }: ChipInput): ChipResult {
  const conn = connection && connection.status !== "showcase" ? connection : null;   // a showcase row is never a connection
  const gateOpen = availability?.gateStatus === "ready";
  const live = availability?.mode === "live" && gateOpen;

  if (conn && conn.hasCredentials && conn.status !== "disconnected") {
    if (conn.status === "needs_attention") return { state: "needs_attention", blockReason: null };
    if (conn.status === "error") return { state: "error", blockReason: null };
    if (!availability || availability.mode === "disabled") return { state: "not_available", blockReason: "not_available" };
    // Truthfulness rule: Connected needs credentials + live gate + a live connection that reports connected.
    if (live && conn.mode === "live" && conn.status === "connected") return { state: "connected", blockReason: null };
    return { state: "sandbox", blockReason: null };
  }
  if (conn?.status === "disconnected") return connectable({ availability, envConfigured, base: "disconnected" });
  return connectable({ availability, envConfigured, base: "available" });
}

function connectable({ availability, envConfigured, base }: { availability: AvailabilityRow | null; envConfigured: boolean; base: "available" | "disconnected" }): ChipResult {
  if (!availability || availability.mode === "disabled") return { state: "not_available", blockReason: "not_available" };
  if (!envConfigured) return { state: "not_configured", blockReason: "not_configured" };
  // Sandbox can be connected when the vendor offers it even before approval; live needs the gate to be ready.
  if (availability.mode === "live" && availability.gateStatus !== "ready") return { state: availability.gateStatus, blockReason: availability.gateStatus };
  if (availability.mode === "sandbox") return { state: base, blockReason: null };
  return { state: base, blockReason: null };
}

/** The connection mode a new connection gets, from availability. Never "live" unless the platform says live and the gate is ready. */
export function modeForNewConnection(a: AvailabilityRow | null): ConnMode | null {
  if (!a || a.mode === "disabled") return null;
  return a.mode === "live" && a.gateStatus === "ready" ? "live" : "sandbox";
}
export const isLiveChip = (s: ChipState): boolean => s === "connected";
