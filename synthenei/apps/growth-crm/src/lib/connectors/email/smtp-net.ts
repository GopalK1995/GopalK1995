// Real socket behind SmtpIo (node:net / node:tls). Certificates are always verified; there is no insecure option.
import net from "node:net";
import tls from "node:tls";
import type { SmtpIo, SmtpReply } from "./smtp";

const TIMEOUT_MS = 20_000;

export function connectSmtp(host: string, port: number, implicitTls: boolean): Promise<SmtpIo> {
  return new Promise((resolve, reject) => {
    let sock: net.Socket | tls.TLSSocket;
    let buf = "";
    const waiters: ((r: SmtpReply | Error) => void)[] = [];
    const queue: SmtpReply[] = [];
    let failure: Error | null = null;
    const flush = () => {
      for (;;) {
        const end = /(^|\r?\n)(\d{3}) [^\r\n]*\r?\n/.exec(buf);   // a final line has a space after the code
        if (!end) return;
        const upto = end.index + end[0].length;
        const lines = buf.slice(0, upto).split(/\r?\n/).filter(Boolean);
        buf = buf.slice(upto);
        const reply: SmtpReply = { code: Number(end[2]), lines: lines.map((l) => l.slice(4)) };
        const w = waiters.shift();
        if (w) w(reply); else queue.push(reply);
      }
    };
    const attach = (s: net.Socket | tls.TLSSocket) => {
      sock = s;
      s.setEncoding("utf8"); s.setTimeout(TIMEOUT_MS, () => s.destroy(new Error("timeout")));
      s.on("data", (d: string) => { buf += d; flush(); });
      s.on("error", (e) => { failure = e; for (const w of waiters.splice(0)) w(e); });
      s.on("close", () => { failure ??= new Error("closed"); for (const w of waiters.splice(0)) w(failure); });
    };
    const io: SmtpIo = {
      write: (d) => new Promise((res, rej) => sock.write(d, (e) => (e ? rej(e) : res()))),
      readReply: () => new Promise((res, rej) => {
        const q = queue.shift();
        if (q) return res(q);
        if (failure) return rej(failure);
        waiters.push((r) => (r instanceof Error ? rej(r) : res(r)));
      }),
      startTls: () => new Promise((res, rej) => {
        const plain = sock as net.Socket;
        plain.removeAllListeners("data");
        const secured = tls.connect({ socket: plain, servername: host, rejectUnauthorized: true }, () => res());
        secured.once("error", rej);
        attach(secured);
      }),
      close: () => { try { sock.end(); sock.destroy(); } catch { /* already closed */ } },
    };
    const ready = () => resolve(io);
    const s = implicitTls ? tls.connect({ host, port, servername: host, rejectUnauthorized: true }, ready) : net.connect({ host, port }, ready);
    s.once("error", reject);
    attach(s);
  });
}
