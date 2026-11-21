// SSRF-safe feed fetch. https only, no private or reserved address (checked on the address the socket actually connects to, so a DNS
// rebind cannot slip through), default port only, at most three redirects (each re-validated), 2 MB body cap, 10 s overall deadline,
// no compression (so the cap is the real size), no cookies, no credentials. Server only.
import "server-only";
import dns from "node:dns";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import { FETCH_MAX_BYTES, FETCH_MAX_REDIRECTS, FETCH_TIMEOUT_MS } from "./constants";
import { FeedFetchError, type FeedFetcher, type FeedResponse } from "./fetch-types";
import { checkFeedUrl, isPrivateAddress } from "./ssrf";

export { FeedFetchError, type FeedFetcher, type FeedResponse, type FetchErrorCode } from "./fetch-types";

type Addr = { address: string; family: number };
type Resolve = (host: string, opts: { all: true }, cb: (err: NodeJS.ErrnoException | null, addrs: Addr[]) => void) => void;
type LookupCb = (err: NodeJS.ErrnoException | null, address: string | Addr[], family?: number) => void;

/** A `lookup` function for https.request that refuses to hand back any private address (one bad answer rejects the whole name). */
export function guardedLookup(resolve: Resolve = dns.lookup as unknown as Resolve) {
  return (hostname: string, options: { all?: boolean } | number | undefined, cb: LookupCb): void => {
    const all = typeof options === "object" && options !== null && options.all === true;
    resolve(hostname, { all: true }, (err, addrs) => {
      if (err || !addrs?.length) return cb(Object.assign(new Error("dns"), { code: "ENOTFOUND" }) as NodeJS.ErrnoException, "");
      if (addrs.some((a) => isPrivateAddress(a.address))) return cb(Object.assign(new Error("blocked_address"), { code: "EBLOCKED" }) as NodeJS.ErrnoException, "");
      return all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family);
    });
  };
}

type Request = (url: URL, opts: https.RequestOptions, cb: (res: IncomingMessage) => void) => import("node:http").ClientRequest;
export interface FetcherOpts { request?: Request; lookup?: ReturnType<typeof guardedLookup>; maxBytes?: number; timeoutMs?: number; maxRedirects?: number }

export function makeFeedFetcher(o: FetcherOpts = {}): FeedFetcher {
  const request: Request = o.request ?? ((u, opts, cb) => https.request(u, opts, cb));
  const lookup = o.lookup ?? guardedLookup();
  const maxBytes = o.maxBytes ?? FETCH_MAX_BYTES, timeoutMs = o.timeoutMs ?? FETCH_TIMEOUT_MS, maxRedirects = o.maxRedirects ?? FETCH_MAX_REDIRECTS;

  return (start) => new Promise<FeedResponse>((resolve, reject) => {
    let done = false;
    const settle = (fn: () => void) => { if (!done) { done = true; clearTimeout(timer); fn(); } };
    let current: import("node:http").ClientRequest | null = null;
    const timer = setTimeout(() => { current?.destroy(); settle(() => reject(new FeedFetchError("timeout"))); }, timeoutMs);

    const hop = (raw: string, left: number): void => {
      const chk = checkFeedUrl(raw);
      if (!chk.ok) return settle(() => reject(new FeedFetchError(left === maxRedirects ? "bad_url" : "bad_redirect")));
      const req = request(chk.url, {
        method: "GET", lookup: lookup as unknown as https.RequestOptions["lookup"], agent: false, timeout: timeoutMs,
        headers: { accept: "text/calendar, text/plain;q=0.9, */*;q=0.5", "accept-encoding": "identity", "user-agent": "GrowthCRM-CalendarSync/1" },
      }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (left <= 0) return settle(() => reject(new FeedFetchError("too_many_redirects")));
          let next: string;
          try { next = new URL(res.headers.location, chk.url).toString(); } catch { return settle(() => reject(new FeedFetchError("bad_redirect"))); }
          return hop(next, left - 1);
        }
        const len = Number(res.headers["content-length"]);
        if (Number.isFinite(len) && len > maxBytes) { res.destroy(); return settle(() => reject(new FeedFetchError("too_large"))); }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) { res.destroy(); settle(() => reject(new FeedFetchError("too_large"))); return; }
          chunks.push(c);
        });
        res.on("end", () => settle(() => resolve({ status, body: Buffer.concat(chunks).toString("utf8") })));
        res.on("error", () => settle(() => reject(new FeedFetchError("connect"))));
      });
      current = req;
      req.on("timeout", () => { req.destroy(); settle(() => reject(new FeedFetchError("timeout"))); });
      req.on("error", (e: NodeJS.ErrnoException) => settle(() => reject(new FeedFetchError(e.code === "EBLOCKED" ? "blocked_address" : e.code === "ENOTFOUND" ? "dns" : "connect"))));
      req.end();
    };
    hop(start, maxRedirects);
  });
}
