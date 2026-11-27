import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPrivateAddress, isPrivateHost, looksNumericHost } from "./ip";

export class SsrfError extends Error {
  constructor(public reason: string) { super(`blocked url: ${reason}`); this.name = "SsrfError"; }
}

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

/** True when the literal IP is private, loopback, link-local, metadata, multicast or otherwise non-public (shared classifier, fails closed). */
export function isBlockedIp(ip: string): boolean {
  return isIP(ip) === 0 ? true : isPrivateAddress(ip);
}

/** Throws SsrfError unless the URL is https and every DNS-resolved address is public. Returns the parsed URL. */
export async function assertPublicHttpsUrl(raw: string, resolve: Resolver = defaultResolver): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new SsrfError("invalid url"); }
  if (u.protocol !== "https:") throw new SsrfError("https required");
  if (u.username || u.password) throw new SsrfError("credentials in url");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw new SsrfError("internal host");
  // A literal in any spelling (dotted, decimal, hex, octal, short, IPv6, mapped) is decided without DNS. WHATWG URL already normalises
  // numeric hosts, but the helper decodes them again so a caller that passes a raw string cannot slip a spelling through.
  if (isIP(host) || looksNumericHost(host)) {
    if (isPrivateHost(host)) throw new SsrfError("non-public address");
    return u;
  }
  if (isPrivateHost(host)) throw new SsrfError("internal host");
  let addrs: string[];
  try { addrs = await resolve(host); } catch { throw new SsrfError("dns resolution failed"); }
  if (!addrs.length) throw new SsrfError("dns resolution failed");
  if (addrs.some(isBlockedIp)) throw new SsrfError("non-public address");
  return u;
}
