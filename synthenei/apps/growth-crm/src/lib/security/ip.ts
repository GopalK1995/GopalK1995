// ONE address classifier for every outbound fetch of a tenant-supplied URL (AUD-030 / SEC-043). Pure: no DNS, no network, no server-only
// import, so it is unit tested with tables. Fails closed: anything that is not a parseable IP counts as private.
//   isPrivateV4 / isPrivateAddress  classify a literal address (IPv4, IPv6, IPv4-mapped, NAT64, 6to4, Teredo, compatible forms).
//   parseIpv4Host                   reads the legacy inet_aton host spellings (decimal 2130706433, hex 0x7f000001, octal 0177.0.0.1, short 127.1).
//   isPrivateHost                   classifies a URL hostname: literal forms in any spelling, or an internal-looking name.

/** Strict dotted-quad parse (each octet 0-255, no leading junk). */
export const parseDottedV4 = (ip: string): number[] | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n <= 255) ? p : null;
};

export function isPrivateV4(p: number[]): boolean {
  const [a, b, c] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224                                        // this-network, RFC1918, loopback, multicast + reserved + broadcast
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)                         // CGNAT, link-local incl. 169.254.169.254 metadata
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 168)             // IETF protocol, TEST-NET-1, RFC1918
    || (a === 192 && b === 88 && c === 99)                                                    // 6to4 relay anycast (deprecated)
    || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100)         // benchmarking, TEST-NET-2
    || (a === 203 && b === 0 && c === 113);                                                   // TEST-NET-3
}

/** Expands an IPv6 literal into eight 16-bit groups; null when malformed. Accepts an embedded dotted IPv4 tail and drops a %zone. */
function groups6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (tail) {
    const q = parseDottedV4(tail[1]);
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

/** True for loopback, private, link-local, metadata, multicast, reserved, documentation and unspecified addresses, and for IPv6 forms that
 *  embed one (IPv4-mapped, SIIT, NAT64, 6to4, Teredo, IPv4-compatible). Anything that is not a parseable IP counts as private: fail closed. */
export function isPrivateAddress(ip: string): boolean {
  const four = parseDottedV4(ip);
  if (four) return isPrivateV4(four);
  const g = groups6(ip);
  if (!g) return true;
  const [a, b, c, d, e, f, g6, h] = g;
  const embedded = (hi: number, lo: number) => isPrivateV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) return embedded(g6, h);      // ::ffff:a.b.c.d mapped
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0xffff && f === 0) return embedded(g6, h);      // ::ffff:0:a.b.c.d SIIT
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) return embedded(g6, h);   // 64:ff9b::/96 NAT64
  if (a === 0x64 && b === 0xff9b && c === 1) return true;                                               // 64:ff9b:1::/48 local-use NAT64
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0) return true;                      // ::, ::1, ::a.b.c.d (deprecated compatible)
  if (a === 0x2002) return embedded(b, c);                                                              // 6to4 embeds the v4 in groups 2-3
  if (a === 0x2001 && b === 0) return true;                                                             // 2001::/32 Teredo (embeds an obfuscated v4)
  if (a === 0x2001 && b === 0x0db8) return true;                                                        // 2001:db8::/32 documentation
  if (a === 0x2001 && (b & 0xfff0) === 0x0010) return true;                                             // 2001:10::/28 ORCHID
  if (a === 0x2001 && (b & 0xfff0) === 0x0020) return true;                                             // 2001:20::/28 ORCHIDv2
  if (a === 0x3fff && (b & 0xf000) === 0) return true;                                                  // 3fff::/20 documentation
  if (a === 0x5f00) return true;                                                                        // 5f00::/16 SRv6 SIDs
  if ((a & 0xfe00) === 0xfc00) return true;                                                             // fc00::/7 unique local
  if ((a & 0xffc0) === 0xfe80) return true;                                                             // fe80::/10 link local
  if ((a & 0xffc0) === 0xfec0) return true;                                                             // fec0::/10 site local (deprecated)
  if ((a & 0xff00) === 0xff00) return true;                                                             // ff00::/8 multicast
  if (a === 0x0100 && b === 0 && c === 0 && d === 0) return true;                                       // 100::/64 discard
  return false;
}

const NUM_PART = /^(?:0x[0-9a-f]*|\d+)$/i;
const partValue = (s: string): number | null => {
  if (/^0x/i.test(s)) return s.length === 2 ? 0 : /^0x[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : null;
  if (/^0\d+$/.test(s)) return /^[0-7]+$/.test(s) ? parseInt(s, 8) : null;   // octal; 08 / 09 are invalid
  return /^\d+$/.test(s) ? parseInt(s, 10) : null;
};

/** True when the host is written as a legacy numeric IPv4 (1-4 parts, each decimal, 0x hex or 0 octal). */
export const looksNumericHost = (host: string): boolean => {
  const parts = host.replace(/\.$/, "").split(".");
  return parts.length >= 1 && parts.length <= 4 && parts.every((p) => NUM_PART.test(p));
};

/** inet_aton semantics: "2130706433", "0x7f000001", "0177.0.0.1", "127.1", "0x7f.1". Null when it is not a valid numeric host. */
export function parseIpv4Host(host: string): number[] | null {
  if (!looksNumericHost(host)) return null;
  const vals = host.replace(/\.$/, "").split(".").map(partValue);
  if (vals.some((v) => v === null || !Number.isFinite(v))) return null;
  const n = vals as number[];
  const last = n[n.length - 1];
  const head = n.slice(0, -1);
  if (head.some((v) => v > 255)) return null;
  if (last >= 256 ** (4 - head.length)) return null;
  const out = [...head];
  for (let i = 3 - head.length; i >= 0; i--) out.push(Math.floor(last / 256 ** i) % 256);
  return out;
}

const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".localdomain", ".home.arpa"];

/** Classifies a URL hostname (brackets allowed). Numeric spellings are decoded first, so 2130706433 and 0x7f.1 are loopback. Fails closed. */
export function isPrivateHost(rawHost: string): boolean {
  const host = rawHost.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return true;
  if (host.includes(":")) return isPrivateAddress(host);
  if (looksNumericHost(host)) { const p = parseIpv4Host(host); return p ? isPrivateV4(p) : true; }
  if (/^[0-9.]+$/.test(host)) return true;                                       // digits and dots that did not parse: malformed literal
  if (host === "localhost" || INTERNAL_SUFFIXES.some((x) => host.endsWith(x))) return true;
  return false;
}
