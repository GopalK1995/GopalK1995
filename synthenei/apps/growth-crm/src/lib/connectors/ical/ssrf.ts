// SSRF guards for tenant-supplied feed URLs. Pure (no network): URL shape checks and address classification. The network side
// (resolve, connect, redirects, size, time) lives in fetcher.ts and re-applies these rules at every hop and on the address actually connected.
import { URL_MAX_LENGTH } from "./constants";

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: "too_long" | "bad_url" | "not_https" | "credentials_in_url" | "bad_port" | "ip_literal" | "blocked_host" };

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".localdomain"];

/** https only, a real hostname (never an IP literal), the default port, no userinfo, no internal-looking names. */
export function checkFeedUrl(raw: string): UrlCheck {
  const s = (raw ?? "").trim();
  if (!s || s.length > URL_MAX_LENGTH) return { ok: false, reason: "too_long" };
  let u: URL;
  try { u = new URL(s); } catch { return { ok: false, reason: "bad_url" }; }
  if (u.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (u.username || u.password) return { ok: false, reason: "credentials_in_url" };
  if (u.port && u.port !== "443") return { ok: false, reason: "bad_port" };
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "bad_url" };
  if (host.startsWith("[") || host.includes(":") || /^[0-9.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return { ok: false, reason: "ip_literal" };
  if (!host.includes(".") || host === "localhost" || BLOCKED_SUFFIXES.some((x) => host.endsWith(x))) return { ok: false, reason: "blocked_host" };
  return { ok: true, url: u };
}

const v4 = (ip: string): number[] | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n <= 255) ? p : null;
};

export function isPrivateV4(p: number[]): boolean {
  const [a, b, c] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

/** Expands an IPv6 literal into eight 16-bit groups; null when malformed. Accepts an embedded dotted IPv4 tail. */
function groups6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (tail) {
    const q = v4(tail[1]);
    if (!q) return null;
    s = s.slice(0, -tail[1].length) + ((q[0] << 8) | q[1]).toString(16) + ":" + ((q[2] << 8) | q[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array<string>(fill).fill("0"), ...rest];
  if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

/** True for loopback, private, link-local, multicast, reserved, documentation and unspecified addresses, and for IPv6 forms that embed one
 *  (IPv4-mapped, NAT64, 6to4). Anything that is not a parseable IP counts as private: fail closed. */
export function isPrivateAddress(ip: string): boolean {
  const four = v4(ip);
  if (four) return isPrivateV4(four);
  const g = groups6(ip);
  if (!g) return true;
  const [a, b, c, d, e, f, g6, h] = g;
  const embedded = (hi: number, lo: number) => isPrivateV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  if (g.every((x) => x === 0)) return true;                                   // ::
  if (g.slice(0, 7).every((x) => x === 0) && h === 1) return true;           // ::1
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) return embedded(g6, h);   // ::ffff:a.b.c.d
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0) return true;                  // ::a.b.c.d (deprecated compatible)
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) return embedded(g6, h); // 64:ff9b::/96 NAT64
  if (a === 0x2002) return embedded(b, c);                                    // 6to4 embeds the v4 in groups 2-3
  if ((a & 0xfe00) === 0xfc00) return true;                                   // fc00::/7 unique local
  if ((a & 0xffc0) === 0xfe80) return true;                                   // fe80::/10 link local
  if ((a & 0xff00) === 0xff00) return true;                                   // ff00::/8 multicast
  if (a === 0x2001 && b === 0x0db8) return true;                              // documentation
  if (a === 0x0100 && b === 0 && c === 0 && d === 0) return true;            // 100::/64 discard
  return false;
}
