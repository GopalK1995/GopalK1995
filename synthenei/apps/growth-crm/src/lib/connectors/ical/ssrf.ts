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

// One shared classifier (AUD-030): the same function guards outbound webhooks, REST webhook registration and the feed fetcher.
export { isPrivateAddress, isPrivateV4 } from "@/lib/security/ip";
