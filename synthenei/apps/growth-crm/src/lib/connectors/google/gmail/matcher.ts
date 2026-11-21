// Pure Gmail thread parsing and the known-contact matcher. A thread is kept only when a known contact is the sender or a direct
// recipient (To) of a message in it; Cc-only mentions, mailing lists / bulk mail and threads with no known contact are dropped and never
// stored. Fixture-tested. Message bodies are decoded here and never logged.
import { MAX_BODY } from "./constants";

export interface GHeader { name: string; value: string }
export interface GPart { mimeType?: string; headers?: GHeader[]; body?: { data?: string; size?: number }; parts?: GPart[] }
export interface GMessage { id: string; threadId: string; internalDate?: string; labelIds?: string[]; snippet?: string; payload?: GPart }
export interface GThread { id: string; messages?: GMessage[] }
export interface ContactRef { type: "lead" | "contact"; id: string }

export interface ParsedMessage {
  id: string; threadId: string; messageIdHeader: string | null; references: string | null; subject: string;
  from: string | null; to: string[]; cc: string[]; sentAt: string; direction: "inbound" | "outbound"; body: string; bulk: boolean;
}

const EMAIL = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
/** Every address in a header value ("Name <a@b.c>, d@e.f"), lower-cased, no duplicates. */
export const addressesIn = (v: string | undefined | null): string[] => [...new Set((v ?? "").match(EMAIL)?.map((x) => x.toLowerCase()) ?? [])];

const header = (m: GMessage, name: string): string | null => m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? null;
const b64 = (s: string): string => { try { return Buffer.from(s, "base64url").toString("utf8"); } catch { return ""; } };

function textOf(p: GPart | undefined, want: "text/plain" | "text/html"): string | null {
  if (!p) return null;
  if (p.mimeType === want && p.body?.data) return b64(p.body.data);
  for (const c of p.parts ?? []) { const t = textOf(c, want); if (t) return t; }
  return null;
}
const stripHtml = (h: string): string => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").trim();

export function parseMessage(m: GMessage, selfEmail: string): ParsedMessage | null {
  if (!m.id || !m.threadId) return null;
  const ms = Number(m.internalDate);
  if (!Number.isFinite(ms)) return null;
  const from = addressesIn(header(m, "from"))[0] ?? null;
  const plain = textOf(m.payload, "text/plain") ?? (() => { const h = textOf(m.payload, "text/html"); return h ? stripHtml(h) : m.payload?.body?.data ? b64(m.payload.body.data) : ""; })();
  const bulk = !!header(m, "list-unsubscribe") || /bulk|list|junk/i.test(header(m, "precedence") ?? "") || (header(m, "auto-submitted") ?? "no") !== "no";
  return {
    id: m.id, threadId: m.threadId, messageIdHeader: header(m, "message-id"), references: header(m, "references"), subject: (header(m, "subject") ?? "").trim().slice(0, 300),
    from, to: addressesIn(header(m, "to")), cc: addressesIn(header(m, "cc")), sentAt: new Date(ms).toISOString(),
    direction: from === selfEmail.toLowerCase() ? "outbound" : "inbound", body: plain.trim().slice(0, MAX_BODY), bulk,
  };
}

export type ThreadMatch = { matched: false; reason: "no_messages" | "no_known_contact" | "bulk" } | { matched: true; contact: ContactRef; email: string };

/** `known`: lower-case email -> CRM record, workspace-scoped, from the store. */
export function matchThread(messages: ParsedMessage[], known: Map<string, ContactRef>, selfEmail: string): ThreadMatch {
  if (!messages.length) return { matched: false, reason: "no_messages" };
  const self = selfEmail.toLowerCase();
  if (messages.every((m) => m.bulk)) return { matched: false, reason: "bulk" };
  for (const m of [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt))) {
    if (m.bulk) continue;
    const direct = [m.from, ...m.to].filter((a): a is string => !!a && a !== self);
    for (const a of direct) { const c = known.get(a); if (c) return { matched: true, contact: c, email: a }; }
  }
  return { matched: false, reason: "no_known_contact" };
}

/** Gmail search that lists only mail to or from these addresses, after a time. Google filters; strangers' mail is not listed at all. */
export function buildQuery(addresses: string[], afterEpochSec: number): string {
  const terms = addresses.filter((a) => /^[^\s()"{}:]+@[^\s()"{}:]+$/.test(a)).flatMap((a) => [`from:${a}`, `to:${a}`]);
  return `after:${Math.max(0, Math.floor(afterEpochSec))} (${terms.join(" OR ")})`;
}

/** RFC 2822 reply, base64url for users.messages.send. Header values are stripped of CR/LF (no header injection). */
export function buildReply(i: { from: string; to: string; subject: string; body: string; inReplyTo: string | null; references: string | null }): string {
  const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  const subject = /^re:/i.test(i.subject) ? clean(i.subject) : `Re: ${clean(i.subject)}`;
  const lines = [`From: ${clean(i.from)}`, `To: ${clean(i.to)}`, `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64"];
  if (i.inReplyTo) lines.push(`In-Reply-To: ${clean(i.inReplyTo)}`);
  const refs = [i.references, i.inReplyTo].filter(Boolean).map((x) => clean(x as string)).join(" ");
  if (refs) lines.push(`References: ${refs}`);
  const raw = `${lines.join("\r\n")}\r\n\r\n${Buffer.from(i.body, "utf8").toString("base64")}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}
