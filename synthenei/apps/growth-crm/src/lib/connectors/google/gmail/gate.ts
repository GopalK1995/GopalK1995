// The Gmail gate. Gmail needs a RESTRICTED scope, which Google allows only for (a) an OAuth app in "testing" with at most 100 named test
// users, or (b) an app verified after the CASA security assessment. So Gmail is open only when the app is in testing, or CASA is complete,
// AND the tenant has explicitly opted in. Closed = no scope is requested, nothing is read, nothing is sent. Pure: no I/O.
import { GMAIL_ENV, GMAIL_SCOPES } from "./constants";

type Env = Record<string, string | undefined>;
export type GmailGateReason = "app_mode_unknown" | "app_in_production_unverified" | "not_opted_in";
export interface GmailGate { open: boolean; reasons: GmailGateReason[]; /** testing = limited to named test users; verified = CASA passed; closed otherwise */ mode: "testing" | "verified" | "closed" }

export function gmailGate(env: Env, optedIn: boolean): GmailGate {
  const mode = (env[GMAIL_ENV.appMode] ?? "").trim().toLowerCase();
  const casa = (env[GMAIL_ENV.casaComplete] ?? "").trim().toLowerCase() === "true";
  const reasons: GmailGateReason[] = [];
  let m: GmailGate["mode"] = "closed";
  if (casa && mode === "production") m = "verified";
  else if (mode === "testing") m = "testing";
  else if (mode === "production") reasons.push("app_in_production_unverified");
  else reasons.push("app_mode_unknown");
  if (!optedIn) reasons.push("not_opted_in");
  return { open: reasons.length === 0, reasons, mode: m };
}

/** Scopes to request: none while the gate is closed (a restricted scope is never asked for without an opt-in), else read + send. */
export function gmailScopes(env: Env, optedIn: boolean): string[] {
  return gmailGate(env, optedIn).open ? [GMAIL_SCOPES.read, GMAIL_SCOPES.send] : [];
}

/** The explicit acknowledgements a tenant admin gives before Gmail can be connected. Both must be true. */
export interface GmailOptIn { restrictedScopes: boolean; testUserListed: boolean }
export const isFullOptIn = (a: Partial<GmailOptIn> | null | undefined): boolean => a?.restrictedScopes === true && a?.testUserListed === true;
