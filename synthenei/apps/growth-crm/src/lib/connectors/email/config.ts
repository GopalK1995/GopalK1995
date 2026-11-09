// Picks the transport for a connection. Real sending happens only with real credentials; the mock transport serves demo and
// staging showcases and is refused in production (a tenant pasting the sandbox key there gets a credential error, never a fake "connected").
import { CredentialError, type ConnectionSecrets } from "../core/types";
import { CRED, DEFAULT_RESEND_BASE, EMAIL_ENV, MOCK_API_KEY, MOCK_SMTP_HOST, SET } from "./constants";
import { makeMockTransport, type MockEmailTransport } from "./mock";
import { makeResendTransport } from "./resend";
import { makeSmtpTransport } from "./smtp";
import type { EmailTransport } from "./transport";

type Env = Record<string, string | undefined>;
export const mockAllowed = (env: Env): boolean => env.APP_ENV !== "production";
export const isMockSecrets = (s: ConnectionSecrets): boolean => s[CRED.apiKey] === MOCK_API_KEY || s[CRED.smtpHost] === MOCK_SMTP_HOST;
export const resendBaseOf = (env: Env): string => (env[EMAIL_ENV.resendApiBase] ?? "").trim() || DEFAULT_RESEND_BASE;

const mocks = new Map<string, MockEmailTransport>();
export const resetMockTransports = (): void => mocks.clear();
export const mockFor = (key: string): MockEmailTransport => { let m = mocks.get(key); if (!m) { m = makeMockTransport(); mocks.set(key, m); } return m; };

export interface TransportInput { connectionId: string; connectorId: string; secrets: ConnectionSecrets; env: Env; fetchImpl?: typeof fetch }

export function transportFor(i: TransportInput): EmailTransport {
  const demo = i.env.APP_ENV === "demo";
  const none = i.connectorId === "resend" ? !i.secrets[CRED.apiKey] : !i.secrets[CRED.smtpHost];
  if (isMockSecrets(i.secrets) || (demo && none)) {
    if (!mockAllowed(i.env)) throw new CredentialError("The sandbox credentials are not accepted in production");
    return mockFor(i.connectionId);
  }
  if (i.connectorId === "resend") {
    if (!i.secrets[CRED.apiKey]) throw new CredentialError("Resend credentials are incomplete");
    return makeResendTransport({ apiBase: resendBaseOf(i.env), apiKey: i.secrets[CRED.apiKey], fetch: i.fetchImpl });
  }
  const port = Number(i.secrets[CRED.smtpPort]);
  if (!i.secrets[CRED.smtpHost] || !Number.isInteger(port) || port < 1 || port > 65535) throw new CredentialError("SMTP credentials are incomplete");
  return makeSmtpTransport({
    host: i.secrets[CRED.smtpHost], port, username: i.secrets[CRED.smtpUsername] ?? "", password: i.secrets[CRED.smtpPassword] ?? "",
    connect: async (h, p, tls) => (await import("./smtp-net")).connectSmtp(h, p, tls),
  });
}

/** Tenant-owned sender identity from the connection settings. Nothing here has a default: an unset field stays unset. */
export interface Sender { fromEmail: string | null; fromName: string | null; replyTo: string | null; footer: string | null; dkimSelector: string | null; domainId: string | null }
export function senderOf(settings: Record<string, unknown>): Sender {
  const s = (k: string): string | null => { const v = settings[k]; return typeof v === "string" && v.trim() ? v.trim() : null; };
  return { fromEmail: s(SET.fromEmail), fromName: s(SET.fromName), replyTo: s(SET.replyTo), footer: s(SET.footer), dkimSelector: s(SET.dkimSelector), domainId: s(SET.domainId) };
}
export const domainOf = (email: string | null): string | null => (email && email.includes("@") ? email.split("@")[1].toLowerCase() : null);
/** True when the connection runs on the sandbox transport (the UI shows the Showcase label). */
export const isShowcase = (secrets: ConnectionSecrets, env: Env): boolean => isMockSecrets(secrets) || env.APP_ENV === "demo";
