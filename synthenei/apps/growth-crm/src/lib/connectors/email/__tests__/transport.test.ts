// Transports: Resend client (bodies, headers, error mapping, domain state), SMTP session over a scripted server, DNS check, config selection.
import { describe, expect, it } from "vitest";
import { CredentialError, TransientError } from "../../core/types";
import { isMockSecrets, mockAllowed, resetMockTransports, senderOf, transportFor } from "../config";
import { checkDomainDns } from "../dns-check";
import { checkSendingDomain, domainStateOf } from "../domain";
import { makeResendTransport, mapResendDomain } from "../resend";
import { makeSmtpTransport, type SmtpIo, type SmtpReply } from "../smtp";
import { EmailApiError, type OutboundEmail } from "../transport";
import { CONN } from "./fake";

const MSG: OutboundEmail = { from: { email: "news@brand.test", name: "Brand" }, to: { email: "a@example.com" }, subject: "S", text: "T", html: "<p>T</p>", headers: { "List-Unsubscribe": "<https://x.test/u>" }, tags: { crm_msg: "m-1" }, idempotencyKey: "idem-1" };
type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
function fakeFetch(script: (c: Call) => { status: number; json?: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const c: Call = { url, method: String(init.method), headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])), body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const r = script(c);
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status, headers: r.headers });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("Resend client", () => {
  it("posts the message with bearer key, idempotency key, tags and unsubscribe headers", async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200, json: { id: "re_1" } }));
    const t = makeResendTransport({ apiBase: "http://stub.invalid/", apiKey: "re_secretkey", fetch: f });
    expect(await t.send({ ...MSG, replyTo: { email: "help@brand.test" } })).toEqual({ providerId: "re_1" });
    expect(calls[0].url).toBe("http://stub.invalid/emails");
    expect(calls[0].headers.authorization).toBe("Bearer re_secretkey");
    expect(calls[0].headers["idempotency-key"]).toBe("idem-1");
    expect(calls[0].body).toMatchObject({ from: "Brand <news@brand.test>", to: ["a@example.com"], reply_to: "help@brand.test", tags: [{ name: "crm_msg", value: "m-1" }], headers: { "List-Unsubscribe": "<https://x.test/u>" } });
  });
  it("maps 401 to CredentialError, 429/5xx/network to TransientError, 422 invalid recipient to a refusal, other 4xx to a permanent error", async () => {
    const run = (status: number, json?: unknown, headers?: Record<string, string>) => makeResendTransport({ apiBase: "http://s", apiKey: "k", fetch: fakeFetch(() => ({ status, json, headers })).f }).send(MSG);
    await expect(run(401)).rejects.toBeInstanceOf(CredentialError);
    await expect(run(429, {}, { "retry-after": "7" })).rejects.toMatchObject({ name: "TransientError", retryAfterMs: 7000 });
    await expect(run(503)).rejects.toBeInstanceOf(TransientError);
    await expect(run(422, { name: "invalid_to_address" })).rejects.toMatchObject({ failure: "invalid_recipient" });
    await expect(run(422, { name: "validation_error" })).rejects.toMatchObject({ failure: "invalid_request" });
    await expect(run(413)).rejects.toMatchObject({ failure: "message_too_large" });
    const net = makeResendTransport({ apiBase: "http://s", apiKey: "k", fetch: (async () => { throw new Error("down"); }) as unknown as typeof fetch });
    await expect(net.send(MSG)).rejects.toBeInstanceOf(TransientError);
  });
  it("never puts the vendor's error text or the key in a thrown message", async () => {
    const t = makeResendTransport({ apiBase: "http://s", apiKey: "re_topsecret", fetch: fakeFetch(() => ({ status: 400, json: { message: "bad address a@example.com" } })).f });
    const e = await t.send(MSG).catch((x: Error) => x);
    expect(String((e as Error).message)).not.toMatch(/example\.com|topsecret/);
  });
  it("ping: a valid send-only key (403 on /domains) is fine, a dead key is a CredentialError", async () => {
    await expect(makeResendTransport({ apiBase: "http://s", apiKey: "k", fetch: fakeFetch((c) => (c.url.endsWith("/domains") ? { status: 403, json: {} } : { status: 200 })).f }).ping()).resolves.toBeUndefined();
    await expect(makeResendTransport({ apiBase: "http://s", apiKey: "k", fetch: fakeFetch(() => ({ status: 401, json: {} })).f }).ping()).rejects.toBeInstanceOf(CredentialError);
  });
  it("domain.ensure creates the domain when missing, asks for a re-check and returns what the API says (no invented verification)", async () => {
    const { f, calls } = fakeFetch((c) => {
      if (c.method === "GET" && c.url.endsWith("/domains")) return { status: 200, json: { data: [] } };
      if (c.method === "POST" && c.url.endsWith("/domains")) return { status: 200, json: { id: "dom_1" } };
      if (c.method === "POST") return { status: 200, json: {} };
      return { status: 200, json: { id: "dom_1", status: "pending", records: [{ record: "SPF", name: "send", type: "MX", value: "feedback", status: "pending" }, { record: "DKIM", name: "resend._domainkey", type: "TXT", value: "p=ABC", status: "verified" }] } };
    });
    const s = await makeResendTransport({ apiBase: "http://s", apiKey: "k", fetch: f }).domain!.ensure("brand.test");
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/domains") && (c.body as { name: string }).name === "brand.test")).toBe(true);
    expect(s.status).toBe("pending");
    expect(s.records.map((r) => [r.kind, r.status])).toEqual([["spf", "pending"], ["dkim", "verified"]]);
  });
  it("mapResendDomain: unknown or missing statuses are never 'verified'", () => {
    const at = "2026-11-01T00:00:00Z";
    expect(mapResendDomain({ status: "weird", records: [{ record: "DKIM", status: "weird" }] }, "x.test", at)).toMatchObject({ status: "unknown", records: [{ kind: "dkim", status: "unknown" }] });
    expect(mapResendDomain(null, "x.test", at)).toMatchObject({ status: "unknown", records: [] });
    expect(mapResendDomain({ status: "temporary_failure" }, "x.test", at).status).toBe("pending");
    expect(mapResendDomain({ status: "verified", records: [{ record: "x", value: "v=spf1 include:a ~all", status: "verified" }] }, "x.test", at).records[0].kind).toBe("spf");
  });
});

// ---- SMTP over a scripted server ----
function script(replies: (string | [number, string[]])[], onWrite: (s: string) => void = () => {}): { io: SmtpIo; written: string[]; closed: () => boolean; tls: () => boolean } {
  const q = replies.map((r): SmtpReply => (typeof r === "string" ? { code: Number(r.slice(0, 3)), lines: [r.slice(4)] } : { code: r[0], lines: r[1] }));
  const written: string[] = []; let closed = false, tls = false;
  return {
    written, closed: () => closed, tls: () => tls,
    io: { async write(d) { written.push(d); onWrite(d); }, async readReply() { const r = q.shift(); if (!r) throw new Error("script exhausted"); return r; }, async startTls() { tls = true; }, close() { closed = true; } },
  };
}
const OK_FLOW: (string | [number, string[]])[] = ["220 hi", [250, ["host", "STARTTLS"]], "220 go", [250, ["host", "AUTH PLAIN LOGIN"]], "235 ok", "250 ok", "250 ok", "354 go", "250 queued"];
const smtp = (s: ReturnType<typeof script>, port = 587) => makeSmtpTransport({ host: "smtp.test", port, username: "u", password: "p", connect: async () => s.io });

describe("SMTP session", () => {
  it("upgrades with STARTTLS before AUTH, then MAIL/RCPT/DATA with dot-stuffed content and the unsubscribe header", async () => {
    const s = script(OK_FLOW);
    const r = await smtp(s).send({ ...MSG, text: ".leading dot" });
    expect(r.providerId).toMatch(/^[0-9a-f]{24}@brand\.test$/);
    const w = s.written.join("");
    expect(w.indexOf("STARTTLS")).toBeLessThan(w.indexOf("AUTH PLAIN"));
    expect(s.tls()).toBe(true);
    expect(w).toContain(`AUTH PLAIN ${Buffer.from("\0u\0p").toString("base64")}`);
    expect(w).toContain("MAIL FROM:<news@brand.test>");
    expect(w).toContain("RCPT TO:<a@example.com>");
    expect(w).toContain("List-Unsubscribe: <https://x.test/u>");
    expect(w).toContain("\r\n.\r\n");
    expect(s.closed()).toBe(true);
  });
  it("refuses to authenticate without TLS (no STARTTLS offered) and closes the socket", async () => {
    const s = script(["220 hi", [250, ["host", "AUTH PLAIN"]]]);
    await expect(smtp(s).send(MSG)).rejects.toMatchObject({ failure: "rejected" });
    expect(s.written.join("")).not.toContain("AUTH");
    expect(s.closed()).toBe(true);
  });
  it("uses implicit TLS on 465 (no STARTTLS command)", async () => {
    const s = script(["220 hi", [250, ["host", "AUTH PLAIN"]], "235 ok", "250 ok", "250 ok", "354 go", "250 queued"]);
    await smtp(s, 465).send(MSG);
    expect(s.written.join("")).not.toContain("STARTTLS");
  });
  it("falls back to AUTH LOGIN when PLAIN is not offered", async () => {
    const s = script(["220 hi", [250, ["host", "STARTTLS"]], "220 go", [250, ["host", "AUTH LOGIN"]], "334 VXNlcm5hbWU6", "334 UGFzc3dvcmQ6", "235 ok", "250 ok", "250 ok", "354 go", "250 queued"]);
    await smtp(s).send(MSG);
    expect(s.written.join("")).toContain("AUTH LOGIN");
  });
  it("maps replies: 535 = CredentialError, 4xx = transient, 550 on RCPT = recipient refusal, other 5xx = rejected", async () => {
    const flow = (at: number, reply: string) => { const f = [...OK_FLOW]; f[at] = reply; return smtp(script(f)).send(MSG); };
    await expect(flow(4, "535 auth failed")).rejects.toBeInstanceOf(CredentialError);
    await expect(flow(6, "451 try later")).rejects.toBeInstanceOf(TransientError);
    await expect(flow(6, "550 no such user")).rejects.toMatchObject({ failure: "invalid_recipient" });
    await expect(flow(5, "554 blocked")).rejects.toMatchObject({ failure: "rejected" });
    await expect(flow(8, "552 too big")).rejects.toMatchObject({ failure: "message_too_large" });
    await expect(flow(8, "451 later")).rejects.toBeInstanceOf(TransientError);
  });
  it("an unreachable server is a transient error; ping authenticates without sending mail", async () => {
    await expect(makeSmtpTransport({ host: "h", port: 587, username: "", password: "", connect: async () => { throw new Error("ECONNREFUSED"); } }).send(MSG)).rejects.toBeInstanceOf(TransientError);
    const s = script(["220 hi", [250, ["host", "STARTTLS"]], "220 go", [250, ["host", "AUTH PLAIN"]], "235 ok"]);
    await smtp(s).ping();
    expect(s.written.join("")).not.toContain("MAIL FROM");
    expect(s.closed()).toBe(true);
    const bad = script(["220 hi", [250, ["host", "STARTTLS"]], "220 go", [250, ["host", "AUTH PLAIN"]], "535 no"]);
    await expect(smtp(bad).ping()).rejects.toBeInstanceOf(CredentialError);
  });
  it("a recipient refusal from SMTP is an EmailApiError (the pipeline suppresses on it)", async () => {
    const f = [...OK_FLOW]; f[6] = "550 gone";
    expect(await smtp(script(f)).send(MSG).catch((e) => e)).toBeInstanceOf(EmailApiError);
  });
});

describe("DNS check (SMTP connections)", () => {
  const dns = (map: Record<string, string[][] | "ENOTFOUND" | "ETIMEOUT">) => async (h: string) => { const v = map[h]; if (v === "ENOTFOUND" || v === "ETIMEOUT" || v === undefined) throw Object.assign(new Error("x"), { code: v === "ETIMEOUT" ? "ETIMEOUT" : "ENOTFOUND" }); return v; };
  const at = new Date("2026-11-01T00:00:00Z");
  it("SPF + DKIM published = verified; a missing record = failed; nothing is asserted about what we could not ask", async () => {
    const ok = await checkDomainDns(dns({ "brand.test": [["v=spf1 include:mail.test ~all"]], "s1._domainkey.brand.test": [["v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC"]], "_dmarc.brand.test": [["v=DMARC1; p=none"]] }), "brand.test", "s1", at);
    expect(ok.status).toBe("verified");
    expect(ok.records.map((r) => [r.kind, r.status])).toEqual([["spf", "verified"], ["dkim", "verified"], ["dmarc", "verified"]]);
    const noSpf = await checkDomainDns(dns({ "brand.test": [["google-site-verification=abc"]], "s1._domainkey.brand.test": [["v=DKIM1; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC"]] }), "brand.test", "s1", at);
    expect(noSpf.status).toBe("failed");
    expect(noSpf.records[0].status).toBe("failed");
  });
  it("without a DKIM selector DKIM is unknown (not failed, not verified); a resolver outage is unknown", async () => {
    const r = await checkDomainDns(dns({ "brand.test": [["v=spf1 -all"]] }), "brand.test", null, at);
    expect(r.status).toBe("unknown");
    expect(r.records.find((x) => x.kind === "dkim")!.status).toBe("unknown");
    const outage = await checkDomainDns(dns({ "brand.test": "ETIMEOUT", "s1._domainkey.brand.test": "ETIMEOUT" }), "brand.test", "s1", at);
    expect(outage.status).toBe("unknown");
  });
  it("checkSendingDomain uses the sender's domain; no sender = no check; the sandbox says showcase", async () => {
    const mockT = transportFor({ connectionId: "c", connectorId: "resend", secrets: { api_key: "re_mock_key" }, env: { APP_ENV: "staging" } });
    const r = await checkSendingDomain(CONN(), mockT, at);
    expect(r).toMatchObject({ ok: true, state: { status: "showcase", domain: "brand.test" } });
    expect(await checkSendingDomain(CONN({ settings: {} }), mockT, at)).toEqual({ ok: false, reason: "no_sender" });
  });
  it("domainStateOf tolerates junk", () => {
    expect(domainStateOf(null)).toBeNull();
    expect(domainStateOf({ domain: 5 })).toBeNull();
    expect(domainStateOf({ domain: { status: "pending", domain: "x.test", records: [], checkedAt: "t" } })).toMatchObject({ status: "pending" });
  });
});

describe("transport selection", () => {
  it("sandbox key selects the mock transport outside production and is refused in production", () => {
    resetMockTransports();
    expect(transportFor({ connectionId: "c", connectorId: "resend", secrets: { api_key: "re_mock_key" }, env: { APP_ENV: "staging" } }).kind).toBe("mock");
    expect(() => transportFor({ connectionId: "c", connectorId: "resend", secrets: { api_key: "re_mock_key" }, env: { APP_ENV: "production" } })).toThrow(CredentialError);
    expect(mockAllowed({ APP_ENV: "production" })).toBe(false);
    expect(isMockSecrets({ smtp_host: "mock.smtp.invalid" })).toBe(true);
  });
  it("demo mode without credentials is the mock; real credentials get the real transport; incomplete ones are rejected", () => {
    expect(transportFor({ connectionId: "c", connectorId: "email-smtp", secrets: {}, env: { APP_ENV: "demo" } }).kind).toBe("mock");
    expect(transportFor({ connectionId: "c", connectorId: "resend", secrets: { api_key: "re_real12345" }, env: { APP_ENV: "staging", RESEND_API_BASE: "http://stub" } }).kind).toBe("resend");
    expect(transportFor({ connectionId: "c", connectorId: "email-smtp", secrets: { smtp_host: "smtp.test", smtp_port: "587", smtp_username: "u", smtp_password: "p" }, env: { APP_ENV: "staging" } }).kind).toBe("smtp");
    expect(() => transportFor({ connectionId: "c", connectorId: "resend", secrets: {}, env: { APP_ENV: "staging" } })).toThrow(CredentialError);
    expect(() => transportFor({ connectionId: "c", connectorId: "email-smtp", secrets: { smtp_host: "h", smtp_port: "99999" }, env: { APP_ENV: "staging" } })).toThrow(CredentialError);
  });
  it("the same mock transport is reused per connection (a showcase keeps its sent list)", () => {
    resetMockTransports();
    const a = transportFor({ connectionId: "c9", connectorId: "resend", secrets: { api_key: "re_mock_key" }, env: {} });
    expect(transportFor({ connectionId: "c9", connectorId: "resend", secrets: { api_key: "re_mock_key" }, env: {} })).toBe(a);
  });
  it("sender identity comes only from settings: unset stays unset", () => {
    expect(senderOf({})).toEqual({ fromEmail: null, fromName: null, replyTo: null, footer: null, dkimSelector: null, domainId: null });
    expect(senderOf({ from_email: "  a@b.test ", from_name: 5 })).toMatchObject({ fromEmail: "a@b.test", fromName: null });
  });
});

describe("platform system sender", () => {
  it("sends nothing and reports queued unless the sender and key come from the env", async () => {
    const { platformEmailSender } = await import("../platform");
    const msg = { to: "user@example.com", subject: "S", text: "T", dedupe: "d1" };
    expect(await platformEmailSender({}).send(msg)).toEqual({ status: "queued" });
    expect(await platformEmailSender({ EMAIL_FROM: "system@platform.test" }).send(msg)).toEqual({ status: "queued" });
    expect(await platformEmailSender({ RESEND_API_KEY: "re_x12345678" }).send(msg)).toEqual({ status: "queued" });
    const { f, calls } = fakeFetch(() => ({ status: 200, json: { id: "re_sys" } }));
    const ok = await platformEmailSender({ EMAIL_FROM: "system@platform.test", RESEND_API_KEY: "re_x12345678", RESEND_API_BASE: "http://stub" }, f).send(msg);
    expect(ok).toEqual({ status: "sent", providerId: "re_sys" });
    expect(calls[0].body).toMatchObject({ from: "system@platform.test", to: ["user@example.com"] });
    expect(calls[0].headers["idempotency-key"]).toBe("sys:d1");
  });
  it("refuses the sandbox key in production", async () => {
    const { platformEmailSender } = await import("../platform");
    expect(await platformEmailSender({ EMAIL_FROM: "a@b.test", RESEND_API_KEY: "re_mock_key", APP_ENV: "production" }).send({ to: "u@example.com", subject: "S", text: "T", dedupe: "d" })).toMatchObject({ status: "failed" });
  });
});
