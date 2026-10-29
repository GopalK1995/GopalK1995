import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class SsrfError extends Error {
  constructor(public reason: string) { super(`blocked url: ${reason}`); this.name = "SsrfError"; }
}

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
}
const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

/** True when the literal IP is private, loopback, link-local, metadata, multicast or otherwise non-public. */
export function isBlockedIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) {
    const n = v4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const b = v4ToInt(base);
      return n >= b && n < b + 2 ** (32 - bits);
    });
  }
  if (fam === 6) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    const hex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const a = parseInt(hex[1], 16), b = parseInt(hex[2], 16);
      return isBlockedIp(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`);
    }
    if (s === "::" || s === "::1") return true;
    if (/^f[cd]/.test(s)) return true; // fc00::/7 unique local
    if (/^fe[89ab]/.test(s)) return true; // fe80::/10 link-local
    if (/^ff/.test(s)) return true; // multicast
    if (s.startsWith("64:ff9b:")) return true; // NAT64
    return false;
  }
  return true;
}

/** Throws SsrfError unless the URL is https and every DNS-resolved address is public. Returns the parsed URL. */
export async function assertPublicHttpsUrl(raw: string, resolve: Resolver = defaultResolver): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new SsrfError("invalid url"); }
  if (u.protocol !== "https:") throw new SsrfError("https required");
  if (u.username || u.password) throw new SsrfError("credentials in url");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) throw new SsrfError("internal host");
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfError("non-public address");
    return u;
  }
  let addrs: string[];
  try { addrs = await resolve(host); } catch { throw new SsrfError("dns resolution failed"); }
  if (!addrs.length) throw new SsrfError("dns resolution failed");
  if (addrs.some(isBlockedIp)) throw new SsrfError("non-public address");
  return u;
}
