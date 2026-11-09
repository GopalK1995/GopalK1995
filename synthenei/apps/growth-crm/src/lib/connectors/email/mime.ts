// MIME message builder for the SMTP transport (Resend takes the same fields as JSON). Pure.
// multipart/alternative (text + html), base64 bodies, RFC 2047 encoded subject and display names, header injection refused.
import { randomBytes } from "node:crypto";

export interface Address { email: string; name?: string }
export interface MimeInput {
  from: Address; to: Address; replyTo?: Address; subject: string; text: string; html?: string;
  headers?: Record<string, string>; messageId?: string; date?: Date;
}

export class MimeError extends Error { constructor(m: string) { super(m); this.name = "MimeError"; } }

const EMAIL_RE = /^[^\s@<>(),;:"\\]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const isEmail = (s: string): boolean => s.length <= 254 && EMAIL_RE.test(s);
const noBreaks = (s: string, what: string): string => { if (/[\r\n\0]/.test(s)) throw new MimeError(`${what} contains a line break`); return s; };
const ascii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/** RFC 2047 encoded-word(s) for non-ASCII header text; chunks keep each word under 75 chars. */
export function encodeWord(s: string): string {
  noBreaks(s, "header");
  if (ascii(s)) return s;
  const words: string[] = [];
  let cur = "";
  for (const ch of s) {
    if (Buffer.byteLength(cur + ch) > 36) { words.push(cur); cur = ""; }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join(" ");
}
export function formatAddress(a: Address): string {
  if (!isEmail(a.email)) throw new MimeError("invalid email address");
  if (!a.name) return a.email;
  const n = noBreaks(a.name, "display name");
  return `${ascii(n) ? `"${n.replace(/(["\\])/g, "\\$1")}"` : encodeWord(n)} <${a.email}>`;
}
const wrap76 = (b64: string) => b64.replace(/(.{76})/g, "$1\r\n");
const b64 = (s: string) => wrap76(Buffer.from(s, "utf8").toString("base64"));
const FORBIDDEN_HEADERS = new Set(["from", "to", "cc", "bcc", "subject", "date", "message-id", "mime-version", "content-type", "content-transfer-encoding", "reply-to"]);

export function buildMime(i: MimeInput): { raw: string; messageId: string } {
  const domain = i.from.email.split("@")[1] ?? "localhost";
  const messageId = i.messageId ?? `<${randomBytes(12).toString("hex")}@${domain}>`;
  noBreaks(messageId, "message id");
  const lines: string[] = [
    `From: ${formatAddress(i.from)}`, `To: ${formatAddress(i.to)}`,
    ...(i.replyTo ? [`Reply-To: ${formatAddress(i.replyTo)}`] : []),
    `Subject: ${encodeWord(i.subject)}`, `Date: ${(i.date ?? new Date()).toUTCString()}`, `Message-ID: ${messageId}`, "MIME-Version: 1.0",
  ];
  for (const [k, v] of Object.entries(i.headers ?? {})) {
    if (!/^[A-Za-z][A-Za-z0-9-]{0,60}$/.test(k) || FORBIDDEN_HEADERS.has(k.toLowerCase())) throw new MimeError("header name not allowed");
    lines.push(`${k}: ${noBreaks(v, "header")}`);
  }
  let body: string;
  if (i.html) {
    const boundary = `=_${randomBytes(12).toString("hex")}`;
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(i.text),
      `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(i.html),
      `--${boundary}--`, "",
    ].join("\r\n");
  } else {
    lines.push("Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64");
    body = `${b64(i.text)}\r\n`;
  }
  return { raw: `${lines.join("\r\n")}\r\n\r\n${body}`, messageId };
}

/** SMTP DATA section: dot-stuffed, CRLF terminated, ending with <CRLF>.<CRLF>. */
export function dotStuff(raw: string): string {
  const s = raw.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
  return `${s.endsWith("\r\n") ? s : `${s}\r\n`}.\r\n`;
}
