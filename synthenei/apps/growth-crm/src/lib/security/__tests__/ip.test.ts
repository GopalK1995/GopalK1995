// Reserved-range table for the ONE shared address classifier (AUD-030 / SEC-043). Pure: no DNS, no sockets.
import { describe, expect, it } from "vitest";
import { assertPublicHttpsUrl, isBlockedIp } from "../ssrf";
import { isPrivateAddress, isPrivateHost, parseIpv4Host } from "../ip";
import { checkFeedUrl, isPrivateAddress as icalIsPrivate } from "@/lib/connectors/ical/ssrf";

// First, last, and one-past-each-edge of every IPv4 range in IANA special-purpose registry that must never be fetched.
const V4_BLOCKED: [string, string][] = [
  ["0.0.0.0", "0.255.255.255"], ["10.0.0.0", "10.255.255.255"], ["100.64.0.0", "100.127.255.255"], ["127.0.0.0", "127.255.255.255"],
  ["169.254.0.0", "169.254.255.255"], ["172.16.0.0", "172.31.255.255"], ["192.0.0.0", "192.0.0.255"], ["192.0.2.0", "192.0.2.255"],
  ["192.88.99.0", "192.88.99.255"], ["192.168.0.0", "192.168.255.255"], ["198.18.0.0", "198.19.255.255"], ["198.51.100.0", "198.51.100.255"],
  ["203.0.113.0", "203.0.113.255"], ["224.0.0.0", "239.255.255.255"], ["240.0.0.0", "255.255.255.255"],
];
const V4_PUBLIC_EDGES = ["9.255.255.255", "11.0.0.0", "100.63.255.255", "100.128.0.0", "126.255.255.255", "128.0.0.0", "169.253.255.255", "169.255.0.0",
  "172.15.255.255", "172.32.0.0", "192.0.1.0", "192.0.3.0", "192.88.98.255", "192.88.100.0", "192.167.255.255", "192.169.0.0", "198.17.255.255", "198.20.0.0",
  "198.51.99.255", "198.51.101.0", "203.0.112.255", "203.0.114.0", "223.255.255.255", "8.8.8.8", "1.1.1.1", "93.184.216.34"];

describe("IPv4 reserved ranges", () => {
  it.each(V4_BLOCKED.flat())("%s is private", (ip) => { expect(isPrivateAddress(ip)).toBe(true); expect(isBlockedIp(ip)).toBe(true); });
  it.each(V4_PUBLIC_EDGES)("%s is public", (ip) => { expect(isPrivateAddress(ip)).toBe(false); expect(isBlockedIp(ip)).toBe(false); });
  it("cloud metadata endpoints are private", () => {
    for (const ip of ["169.254.169.254", "169.254.170.2", "100.100.100.200", "192.0.0.192"]) expect(isPrivateAddress(ip)).toBe(true);
  });
});

describe("IPv6 reserved ranges", () => {
  it.each([
    "::", "::1", "0:0:0:0:0:0:0:1", "::2",                                    // unspecified, loopback, compatible
    "::127.0.0.1", "::8.8.8.8",                                               // IPv4-compatible (deprecated): blocked even when the v4 is public
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "0:0:0:0:0:ffff:c0a8:1",   // mapped
    "::ffff:0:127.0.0.1", "::ffff:0:a00:1",                                   // SIIT
    "64:ff9b::7f00:1", "64:ff9b::a00:1", "64:ff9b::169.254.169.254", "64:ff9b:1::1",                                              // NAT64
    "2002:7f00:1::", "2002:a00:1::1", "2002:c0a8:101::", "2002:a9fe:a9fe::",                                                    // 6to4 embedding private v4
    "2001::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2",                          // Teredo
    "2001:db8::1", "2001:db8:ffff::", "3fff::1", "3fff:fff::1", "2001:10::1", "2001:2f::1", "2001:20::1",                      // documentation, ORCHID
    "5f00::1", "fc00::1", "fd12:3456::1", "fdff:ffff::", "fe80::1", "fe80::abcd%eth0", "febf::1", "fec0::1", "feff::1",         // SRv6, ULA, link-local, site-local
    "ff00::1", "ff02::1", "ff05::2", "ffff::1", "100::", "100::1",              // multicast, discard
    "[::1]", "0::1", "0000:0000:0000:0000:0000:0000:0000:0001",                // bracketed and long forms
  ])("%s is private", (ip) => { expect(isPrivateAddress(ip)).toBe(true); });
  it.each([
    "2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001::", "2400:cb00::1", "2620:fe::fe",
    "::ffff:8.8.8.8", "::ffff:808:808", "64:ff9b::808:808", "2002:808:808::", "2001:1::1", "2001:4000::1",
    "2001:30::1", "3ffe::1", "3fff:1000::1", "5f01::1", "fbff::1", "fe7f::1", "2000::1",
  ])("%s is public", (ip) => { expect(isPrivateAddress(ip)).toBe(false); });
  it.each(["", " ", "garbage", "1.2.3", "1.2.3.4.5", "256.1.1.1", "1.2.3.256", "::g", ":::", "1::2::3", "12345::1", "::1::", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7", "01.2.3.4.5", "8.8.8.8/8", "8.8.8.8:80"])(
    "malformed %j fails closed (private)", (ip) => { expect(isPrivateAddress(ip)).toBe(true); });
});

describe("numeric host spellings (decimal, hex, octal, short)", () => {
  it.each([
    ["2130706433", [127, 0, 0, 1]], ["0x7f000001", [127, 0, 0, 1]], ["0X7F000001", [127, 0, 0, 1]], ["017700000001", [127, 0, 0, 1]],
    ["0177.0.0.1", [127, 0, 0, 1]], ["0x7f.0.0.1", [127, 0, 0, 1]], ["0x7f.1", [127, 0, 0, 1]], ["127.1", [127, 0, 0, 1]],
    ["3232235521", [192, 168, 0, 1]], ["0xc0a80001", [192, 168, 0, 1]], ["0300.0250.0.1", [192, 168, 0, 1]], ["2852039166", [169, 254, 169, 254]],
    ["0xa9fea9fe", [169, 254, 169, 254]], ["0251.0376.0251.0376", [169, 254, 169, 254]], ["167772161", [10, 0, 0, 1]], ["0", [0, 0, 0, 0]], ["0x0", [0, 0, 0, 0]],
    ["4294967295", [255, 255, 255, 255]], ["127.0.0.1.", [127, 0, 0, 1]], ["134744072", [8, 8, 8, 8]],
  ] as [string, number[]][])("%s parses", (h, want) => { expect(parseIpv4Host(h)).toEqual(want); });
  it("127.0.1 is 127.0.0.1 style short form (a.b.c where c is 16 bit)", () => { expect(parseIpv4Host("127.0.1")).toEqual([127, 0, 0, 1]); });
  it.each(["4294967296", "0x100000000", "256.1", "1.256.3", "08", "0128", "0xg", "1.2.3.4.5", "a.b.c.d", "", "1..2", "-1"])("%j does not parse", (h) => {
    expect(parseIpv4Host(h)).toBeNull();
  });
  it.each(["2130706433", "0x7f000001", "0177.0.0.1", "127.1", "0x7f.1", "3232235521", "0xa9fea9fe", "2852039166", "167772161", "0", "0.0.0.0", "00", "017700000001",
    "08", "4294967296", "[::1]", "[::ffff:127.0.0.1]", "127.0.0.1.", "LOCALHOST", "localhost.", "a.localhost", "svc.internal", "host.local", "db.lan", "x.home.arpa", "x.corp", ""])(
    "isPrivateHost(%j) is true", (h) => { expect(isPrivateHost(h)).toBe(true); });
  it.each(["example.com", "8.8.8.8", "134744072", "0x08080808", "[2606:4700:4700::1111]", "sub.example.co.in", "xn--bcher-kva.example", "1.1.1.1"])(
    "isPrivateHost(%j) is false", (h) => { expect(isPrivateHost(h)).toBe(false); });
});

describe("assertPublicHttpsUrl with every spelling (no DNS: literals are decided before resolving)", () => {
  const never = async () => { throw new Error("DNS must not be consulted for a literal"); };
  it.each([
    "https://2130706433/", "https://0x7f000001/", "https://0177.0.0.1/", "https://127.1/", "https://0x7f.1/", "https://017700000001/",
    "https://3232235521/", "https://2852039166/latest/meta-data", "https://0xa9fea9fe/", "https://[::ffff:7f00:1]/", "https://[::ffff:127.0.0.1]/",
    "https://[2002:7f00:1::]/", "https://[64:ff9b::a00:1]/", "https://[::127.0.0.1]/", "https://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/", "https://[fec0::1]/",
    "https://192.88.99.1/", "https://metadata.google.internal/", "https://printer.local/", "https://x.home.arpa/", "https://localhost./",
    "https://0/", "https://0.0.0.0/", "https://[::]/", "https://[::1]/", "http://example.com/", "https://u:p@example.com/",
  ])("rejects %s", async (u) => { await expect(assertPublicHttpsUrl(u, never)).rejects.toThrow(); });
  it.each(["https://8.8.8.8/x", "https://[2606:4700:4700::1111]/", "https://134744072/"])("accepts public literal %s", async (u) => {
    await expect(assertPublicHttpsUrl(u, never)).resolves.toBeInstanceOf(URL);
  });
  it("DNS answers: one private address among public ones rejects the name (resolve-then-validate-all)", async () => {
    for (const bad of ["127.0.0.1", "::1", "2002:7f00:1::", "::ffff:10.0.0.1", "192.88.99.5", "169.254.169.254", "2001::1"]) {
      await expect(assertPublicHttpsUrl("https://rebind.example/", async () => ["93.184.216.34", bad])).rejects.toThrow();
    }
    await expect(assertPublicHttpsUrl("https://ok.example/", async () => ["93.184.216.34", "2606:4700:4700::1111"])).resolves.toBeInstanceOf(URL);
  });
});

describe("one classifier, many callers", () => {
  it("the iCal guard and the outbound-webhook guard agree on every address in the tables", () => {
    for (const ip of [...V4_BLOCKED.flat(), ...V4_PUBLIC_EDGES, "2002:7f00:1::", "::127.0.0.1", "2001::1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(icalIsPrivate(ip)).toBe(isPrivateAddress(ip));
      expect(isBlockedIp(ip)).toBe(isPrivateAddress(ip));
    }
  });
  it("the feed URL guard still refuses IP literals in every spelling", () => {
    for (const u of ["https://127.0.0.1/a", "https://2130706433/a", "https://0x7f000001/a", "https://[::1]/a", "https://[2002:7f00:1::]/a"]) expect(checkFeedUrl(u).ok).toBe(false);
  });
});
