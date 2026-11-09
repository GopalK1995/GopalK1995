// Minimal SMTP submission client for tenants who bring their own mail server. Session logic is pure over an `SmtpIo` so unit tests
// script the server; the real socket lives in smtp-net.ts. TLS is mandatory (implicit on port 465, otherwise STARTTLS): credentials are
// never sent in clear text. Reply codes map to: 4xx transient, 530/534/535 = CredentialError, other 5xx = permanent.
import { CredentialError, TransientError } from "../core/types";
import { buildMime, dotStuff } from "./mime";
import { EmailApiError, type EmailTransport, type OutboundEmail } from "./transport";

export interface SmtpReply { code: number; lines: string[] }
export interface SmtpIo {
  write(data: string): Promise<void>;
  readReply(): Promise<SmtpReply>;
  /** Upgrades the open socket to TLS (after STARTTLS). */
  startTls(): Promise<void>;
  close(): void;
}
export interface SmtpOpts { host: string; port: number; username: string; password: string; connect(host: string, port: number, implicitTls: boolean): Promise<SmtpIo> }

/** Port 465 is implicit TLS; anything else must offer STARTTLS. */
export const isImplicitTls = (port: number): boolean => port === 465;

function classify(r: SmtpReply, what: string): Error {
  if (r.code === 530 || r.code === 534 || r.code === 535) return new CredentialError("The mail server rejected the credentials");
  if (r.code >= 400 && r.code < 500) return new TransientError(`Mail server asked to retry (${r.code})`);
  // 550/551/553/501 on RCPT: the mailbox does not exist or refuses us. The same as a hard bounce.
  if (what === "rcpt" && [550, 551, 553, 501].includes(r.code)) return new EmailApiError("Recipient refused", r.code, "invalid_recipient");
  if (r.code === 552) return new EmailApiError("Message too large", r.code, "message_too_large");
  return new EmailApiError(`Mail server refused the message (${r.code})`, r.code, "rejected");
}
async function expect(io: SmtpIo, ok: number[], what: string): Promise<SmtpReply> {
  const r = await io.readReply();
  if (ok.includes(r.code)) return r;
  throw classify(r, what);
}
const cmd = async (io: SmtpIo, line: string, ok: number[], what: string) => { await io.write(`${line}\r\n`); return expect(io, ok, what); };
const addr = (e: string) => `<${e.replace(/[<>\r\n]/g, "")}>`;

/** Connects, upgrades to TLS, authenticates; runs `fn` on the ready session and always closes the socket. */
async function withSession<T>(o: SmtpOpts, ehloName: string, fn: (io: SmtpIo) => Promise<T>): Promise<T> {
  const implicit = isImplicitTls(o.port);
  let io: SmtpIo;
  try { io = await o.connect(o.host, o.port, implicit); } catch { throw new TransientError("Mail server unreachable"); }
  try {
    await expect(io, [220], "greeting");
    let caps = (await cmd(io, `EHLO ${ehloName}`, [250], "ehlo")).lines.join("\n").toUpperCase();
    if (!implicit) {
      if (!/\bSTARTTLS\b/.test(caps)) throw new EmailApiError("The mail server does not offer TLS", 0, "rejected");
      await cmd(io, "STARTTLS", [220], "starttls");
      await io.startTls();
      caps = (await cmd(io, `EHLO ${ehloName}`, [250], "ehlo")).lines.join("\n").toUpperCase();
    }
    if (o.username) {
      if (/AUTH[ =][^\n]*\bPLAIN\b/.test(caps) || !/\bAUTH\b/.test(caps)) await cmd(io, `AUTH PLAIN ${Buffer.from(`\0${o.username}\0${o.password}`).toString("base64")}`, [235], "auth");
      else {
        await cmd(io, "AUTH LOGIN", [334], "auth");
        await cmd(io, Buffer.from(o.username).toString("base64"), [334], "auth");
        await cmd(io, Buffer.from(o.password).toString("base64"), [235], "auth");
      }
    }
    return await fn(io);
  } finally { io.close(); }
}

export async function smtpSend(o: SmtpOpts, m: OutboundEmail): Promise<{ providerId: string }> {
  const { raw, messageId } = buildMime({ from: m.from, to: m.to, replyTo: m.replyTo, subject: m.subject, text: m.text, html: m.html, headers: m.headers });
  return withSession(o, m.from.email.split("@")[1] ?? "localhost", async (io) => {
    await cmd(io, `MAIL FROM:${addr(m.from.email)}`, [250], "mail");
    await cmd(io, `RCPT TO:${addr(m.to.email)}`, [250, 251], "rcpt");
    await cmd(io, "DATA", [354], "data");
    await io.write(dotStuff(raw));
    await expect(io, [250], "data-end");
    await io.write("QUIT\r\n");
    return { providerId: messageId.replace(/^<|>$/g, "") };
  });
}

export function makeSmtpTransport(o: SmtpOpts): EmailTransport {
  return {
    kind: "smtp",
    send: (m) => smtpSend(o, m),
    ping: () => withSession(o, "localhost", async (io) => { await io.write("QUIT\r\n"); }),
  };
}
