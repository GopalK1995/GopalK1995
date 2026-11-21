// Slack Web API gateway. Every method returns plain data; Slack's `ok:false` envelope is mapped to the framework's errors:
//   token problems (revoked, invalid, inactive account)  -> CredentialError  (the connection goes to needs_attention)
//   channel problems (gone, archived, bot not a member)   -> SlackChannelError (the owner picks another channel)
//   ratelimited / 5xx                                     -> TransientError  (the job retries)
// Error messages carry Slack's error CODE only, never message text, tokens or response bodies.
import { makeVendorHttp } from "../core/http";
import { CredentialError, TransientError, type VendorHttp } from "../core/types";

export interface ChannelAsset { id: string; name: string; isPrivate: boolean; isMember: boolean }
export interface AuthInfo { teamId: string; teamName: string; botUserId: string }
export interface PostInput { channel: string; text: string; blocks: Record<string, unknown>[] }

export class SlackChannelError extends Error {
  constructor(public code: "channel_not_found" | "is_archived" | "not_in_channel" | "restricted_action", message?: string) { super(message ?? `Slack channel problem: ${code}`); this.name = "SlackChannelError"; }
}

export interface SlackGateway {
  kind: "slack" | "mock";
  authTest(): Promise<AuthInfo>;
  /** One page of channels the token can see (public + private it belongs to), archived excluded. */
  listChannels(cursor?: string): Promise<{ channels: ChannelAsset[]; next?: string }>;
  join(channelId: string): Promise<void>;
  post(m: PostInput): Promise<{ ts: string }>;
}

const TOKEN_ERRORS = new Set(["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive", "org_login_required", "no_permission", "missing_scope", "invalid_token"]);
const CHANNEL_ERRORS = new Set(["channel_not_found", "is_archived", "not_in_channel", "restricted_action"]);
const BUSY_ERRORS = new Set(["ratelimited", "service_unavailable", "internal_error", "fatal_error", "request_timeout"]);

type Envelope = { ok?: boolean; error?: string; [k: string]: unknown };
const s = (v: unknown): string => (typeof v === "string" ? v : "");

/** Throws the right error for an `ok:false` envelope; returns the envelope otherwise. */
export function unwrap<T extends Envelope>(e: T): T {
  if (e && e.ok === true) return e;
  const code = s(e?.error) || "unknown_error";
  if (TOKEN_ERRORS.has(code)) throw new CredentialError(`Slack rejected the token (${code}); reconnect Slack`);
  if (CHANNEL_ERRORS.has(code)) throw new SlackChannelError(code as SlackChannelError["code"]);
  if (BUSY_ERRORS.has(code)) throw new TransientError(`Slack is busy (${code})`);
  throw new Error(`Slack request failed (${code})`);
}

export interface RealOpts { apiBase: string; token: string; http?: VendorHttp; fetch?: typeof fetch }

export function makeSlackGateway(o: RealOpts): SlackGateway {
  const http = o.http ?? makeVendorHttp({ maxRetries: 3, baseDelayMs: 500, maxDelayMs: 15_000 }, { fetch: o.fetch });
  const base = o.apiBase.replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${o.token}` };
  const get = (method: string, q: Record<string, string> = {}) =>
    http.json<Envelope>({ method: "GET", url: `${base}/${method}${Object.keys(q).length ? `?${new URLSearchParams(q).toString()}` : ""}`, headers });
  return {
    kind: "slack",
    async authTest() {
      const r = unwrap(await get("auth.test"));
      return { teamId: s(r.team_id), teamName: s(r.team), botUserId: s(r.user_id) };
    },
    async listChannels(cursor) {
      const r = unwrap(await get("conversations.list", { types: "public_channel,private_channel", exclude_archived: "true", limit: "200", ...(cursor ? { cursor } : {}) }));
      const list = Array.isArray(r.channels) ? (r.channels as Record<string, unknown>[]) : [];
      const next = s((r.response_metadata as { next_cursor?: unknown } | undefined)?.next_cursor);
      return { channels: list.filter((c) => s(c.id) && s(c.name)).map((c) => ({ id: s(c.id), name: s(c.name), isPrivate: c.is_private === true, isMember: c.is_member === true })), next: next || undefined };
    },
    async join(channelId) {
      unwrap(await http.json<Envelope>({ method: "POST", url: `${base}/conversations.join?${new URLSearchParams({ channel: channelId }).toString()}`, headers }));
    },
    async post(m) {
      const r = unwrap(await http.json<Envelope>({ method: "POST", url: `${base}/chat.postMessage`, headers, body: { channel: m.channel, text: m.text, blocks: m.blocks, unfurl_links: false, unfurl_media: false } }));
      return { ts: s(r.ts) };
    },
  };
}

// ---- Showcase gateway (sandbox): no network, deterministic sample channels, posted messages kept in memory for the demo and the tests.
export interface MockGateway extends SlackGateway { posted: { channel: string; text: string; blocks: Record<string, unknown>[] }[]; revoke(): void }
export function makeMockGateway(): MockGateway {
  let revoked = false;
  const channels: ChannelAsset[] = [
    { id: "CMOCK0001", name: "sales-alerts", isPrivate: false, isMember: true },
    { id: "CMOCK0002", name: "general", isPrivate: false, isMember: false },
    { id: "GMOCK0003", name: "leadership", isPrivate: true, isMember: true },
  ];
  const guard = () => { if (revoked) throw new CredentialError("Slack rejected the token (token_revoked); reconnect Slack"); };
  const g: MockGateway = {
    kind: "mock", posted: [],
    revoke() { revoked = true; },
    async authTest() { guard(); return { teamId: "TMOCK0001", teamName: "Sample workspace", botUserId: "UMOCK0001" }; },
    async listChannels() { guard(); return { channels: channels.map((c) => ({ ...c })) }; },
    async join(id) { guard(); const c = channels.find((x) => x.id === id); if (!c) throw new SlackChannelError("channel_not_found"); c.isMember = true; },
    async post(m) {
      guard();
      const c = channels.find((x) => x.id === m.channel);
      if (!c) throw new SlackChannelError("channel_not_found");
      if (!c.isMember) throw new SlackChannelError("not_in_channel");
      g.posted.push({ channel: m.channel, text: m.text, blocks: m.blocks });
      return { ts: `${Date.now() / 1000}` };
    },
  };
  return g;
}
