// One HTTP attempt. Every attempt re-validates the destination (SSRF guard at send time, not just at create), then connects to the
// address that was validated (pinned lookup), so a DNS answer that changes between check and connect cannot reach a private address.
// Redirects are never followed: a 3xx is a failure. 10 s timeout, response read capped, excerpt scrubbed and cut to 2 KB.
import { request } from "node:https";
import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { assertPublicHttpsUrl, SsrfError, type Resolver } from "@/lib/security/ssrf";

export const TIMEOUT_MS = 10_000;
export const MAX_RESPONSE_BYTES = 64 * 1024;
export const EXCERPT_CHARS = 2048;

export interface TransportReq { url: URL; address: string; family: 4 | 6; headers: Record<string, string>; body: string; timeoutMs: number; maxBytes: number }
export interface TransportRes { status: number; body: string }
export type Transport = (r: TransportReq) => Promise<TransportRes>;

export type FailKind = "blocked" | "timeout" | "dns" | "tls" | "connection" | "redirect" | "http";
export interface SendResult { ok: boolean; status: number | null; ms: number; excerpt: string | null; kind: FailKind | null }

const defaultResolver: Resolver = async (host) => (await dnsLookup(host, { all: true })).map((r) => r.address);

export const nodeTransport: Transport = (r) => new Promise<TransportRes>((resolve, reject) => {
  const req = request({
    protocol: "https:", hostname: r.url.hostname.replace(/^\[|\]$/g, ""), port: r.url.port || 443, path: r.url.pathname + r.url.search, method: "POST",
    headers: { ...r.headers, "content-length": String(Buffer.byteLength(r.body)) }, servername: isIP(r.url.hostname) ? undefined : r.url.hostname,
    timeout: r.timeoutMs, agent: false,
    lookup: ((_h: string, _o: unknown, cb: (e: Error | null, a: string, f: number) => void) => cb(null, r.address, r.family)) as never,
  }, (res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= r.maxBytes) chunks.push(c);
      else { res.destroy(); }
    });
    const done = () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8").slice(0, r.maxBytes) });
    res.on("end", done); res.on("close", done); res.on("error", done);
  });
  req.on("timeout", () => { req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })); });
  req.on("error", reject);
  req.end(r.body);
});

/** Scrubs a response body into something safe to store: no control characters, emails, bearer tokens or whsec secrets. */
export function safeExcerpt(raw: string): string {
  return raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/whsec_[A-Za-z0-9+/=_-]+/g, "[secret]")
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [token]")
    .replace(/\b(?:\+?\d[\d\s().-]{8,}\d)\b/g, "[number]")
    .slice(0, EXCERPT_CHARS);
}

function failKind(e: unknown): FailKind {
  const code = (e as { code?: string })?.code ?? "";
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "timeout";
  if (/CERT|SSL|TLS|ERR_TLS|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) return "tls";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  return "connection";
}

export async function sendOnce(args: {
  url: string; body: string; headers: Record<string, string>;
  resolver?: Resolver; transport?: Transport; timeoutMs?: number; now?: () => number;
}): Promise<SendResult> {
  const now = args.now ?? Date.now;
  const t0 = now();
  const fail = (kind: FailKind, status: number | null = null, excerpt: string | null = null): SendResult => ({ ok: false, status, ms: now() - t0, excerpt, kind });
  const resolver = args.resolver ?? defaultResolver;
  let url: URL, address: string;
  try {
    const host = (() => { try { return new URL(args.url).hostname.replace(/^\[|\]$/g, ""); } catch { return ""; } })();
    if (host && !isIP(host)) {
      let addrs: string[] = [];
      try { addrs = await resolver(host.toLowerCase()); } catch { /* assertPublicHttpsUrl reports it */ }
      url = await assertPublicHttpsUrl(args.url, async () => addrs);
      address = addrs[0];
    } else {
      url = await assertPublicHttpsUrl(args.url, resolver);
      address = host;
    }
  } catch (e) {
    if (e instanceof SsrfError) return fail("blocked", null, `blocked: ${e.reason}`);
    return fail("connection");
  }
  try {
    const res = await (args.transport ?? nodeTransport)({
      url, address, family: isIP(address) === 6 ? 6 : 4, headers: args.headers, body: args.body,
      timeoutMs: args.timeoutMs ?? TIMEOUT_MS, maxBytes: MAX_RESPONSE_BYTES,
    });
    const excerpt = safeExcerpt(res.body) || null;
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, ms: now() - t0, excerpt, kind: null };
    return fail(res.status >= 300 && res.status < 400 ? "redirect" : "http", res.status, excerpt);
  } catch (e) {
    const kind = failKind(e);
    return fail(kind, null, kind);
  }
}
