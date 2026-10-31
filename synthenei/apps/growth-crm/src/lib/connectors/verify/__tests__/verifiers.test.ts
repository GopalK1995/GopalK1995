import { generateKeyPairSync, createSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import vectors from "../__fixtures__/vectors.json";
import { VERIFIERS, allowListedHeaders, pickSecret, providerEventId, schemeFor } from "../index";
import { hmac, safeEqual } from "../util";

const NOW = 1_700_000_000_000;
const sec = (ms = NOW) => String(Math.floor(ms / 1000));
const H = (o: Record<string, string>) => new Headers(o);
const BODY = '{"event":"x","n":1}';

describe("known-answer vectors", () => {
  it("Standard Webhooks reference vector", () => {
    const v = vectors.standardWebhooksReference;
    const h = H({ "webhook-id": v.id, "webhook-timestamp": v.timestamp, "webhook-signature": v.signature });
    expect(VERIFIERS.standard(v.payload, h, v.secret, { now: Number(v.timestamp) * 1000 })).toBe(true);
    expect(VERIFIERS.standard(v.payload + " ", h, v.secret, { now: Number(v.timestamp) * 1000 })).toBe(false);
  });
  it("Slack docs example vector", () => {
    const v = vectors.slackDocsExample;
    const h = H({ "x-slack-request-timestamp": v.timestamp, "x-slack-signature": v.signature });
    expect(VERIFIERS.slack(v.body, h, v.secret, { now: Number(v.timestamp) * 1000 })).toBe(true);
  });
});

describe("each scheme: valid, tampered body, wrong secret, missing header", () => {
  const S = "s3cret";
  const cases: [string, Record<string, string>][] = [
    ["meta", { "x-hub-signature-256": "sha256=" + hmac(S, BODY, "hex") }],
    ["razorpay", { "x-razorpay-signature": hmac(S, BODY, "hex") }],
    ["slack", { "x-slack-request-timestamp": sec(), "x-slack-signature": "v0=" + hmac(S, `v0:${sec()}:${BODY}`, "hex") }],
    ["calendly", { "calendly-webhook-signature": `t=${sec()},v1=${hmac(S, `${sec()}.${BODY}`, "hex")}` }],
    ["calcom", { "x-cal-signature-256": hmac(S, BODY, "hex") }],
    ["zoho", { "x-zoho-signature": hmac(S, BODY, "base64") }],
    ["standard", { "webhook-id": "m1", "webhook-timestamp": sec(), "webhook-signature": "v1," + hmac(S, `m1.${sec()}.${BODY}`, "base64") }],
    ["hubspot", { "x-hubspot-request-timestamp": String(NOW), "x-hubspot-signature-v3": hmac(S, `POSThttps://x.test/api/hooks/hubspot/id${BODY}${NOW}`, "base64"), "x-hook-method": "POST", "x-hook-url": "https://x.test/api/hooks/hubspot/id" }],
    ["mailchimp", { "x-hook-key": S }],
  ];
  for (const [scheme, hdr] of cases) {
    const v = VERIFIERS[scheme as keyof typeof VERIFIERS];
    it(scheme, async () => {
      expect(await v(BODY, H(hdr), S, { now: NOW })).toBe(true);
      if (scheme !== "mailchimp") expect(await v(BODY + "x", H(hdr), S, { now: NOW })).toBe(false);
      expect(await v(BODY, H(hdr), "other", { now: NOW })).toBe(false);
      expect(await v(BODY, H({}), S, { now: NOW })).toBe(false);
      expect(await v(BODY, H(hdr), "", { now: NOW })).toBe(false);
    });
  }
  it("zoho shared-token form", () => {
    expect(VERIFIERS.zoho(BODY, H({ "x-zoho-token": S }), S)).toBe(true);
    expect(VERIFIERS.zoho(BODY, H({ "x-zoho-token": "no" }), S)).toBe(false);
  });
});

describe("timestamp windows", () => {
  const S = "k";
  it("slack rejects 6 minutes old, accepts 4", () => {
    const mk = (ms: number) => H({ "x-slack-request-timestamp": sec(ms), "x-slack-signature": "v0=" + hmac(S, `v0:${sec(ms)}:${BODY}`, "hex") });
    expect(VERIFIERS.slack(BODY, mk(NOW - 6 * 60_000), S, { now: NOW })).toBe(false);
    expect(VERIFIERS.slack(BODY, mk(NOW - 4 * 60_000), S, { now: NOW })).toBe(true);
    expect(VERIFIERS.slack(BODY, mk(NOW + 6 * 60_000), S, { now: NOW })).toBe(false);
  });
  it("calendly rejects 4 minutes old", () => {
    const t = sec(NOW - 4 * 60_000);
    expect(VERIFIERS.calendly(BODY, H({ "calendly-webhook-signature": `t=${t},v1=${hmac(S, `${t}.${BODY}`, "hex")}` }), S, { now: NOW })).toBe(false);
  });
  it("standard and hubspot reject expired", () => {
    const t = sec(NOW - 10 * 60_000);
    expect(VERIFIERS.standard(BODY, H({ "webhook-id": "a", "webhook-timestamp": t, "webhook-signature": "v1," + hmac(S, `a.${t}.${BODY}`, "base64") }), S, { now: NOW })).toBe(false);
    const ms = String(NOW - 10 * 60_000);
    expect(VERIFIERS.hubspot(BODY, H({ "x-hubspot-request-timestamp": ms, "x-hubspot-signature-v3": hmac(S, `POSTu${BODY}${ms}`, "base64"), "x-hook-method": "POST", "x-hook-url": "u" }), S, { now: NOW })).toBe(false);
  });
  it("standard accepts when any listed v1 signature matches", () => {
    const t = sec();
    expect(VERIFIERS.standard(BODY, H({ "webhook-id": "a", "webhook-timestamp": t, "webhook-signature": "v1,AAAA v1," + hmac(S, `a.${t}.${BODY}`, "base64") }), S, { now: NOW })).toBe(true);
  });
});

describe("google pub/sub JWT", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: "jwk" }) as object), kid: "k1" } as Record<string, unknown>;
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const mint = (claims: Record<string, unknown>, key = privateKey) => {
    const head = b({ alg: "RS256", kid: "k1" }), pay = b(claims);
    return `${head}.${pay}.${createSign("RSA-SHA256").update(`${head}.${pay}`).sign(key).toString("base64url")}`;
  };
  const claims = { iss: "https://accounts.google.com", aud: "https://x.test/hook", exp: NOW / 1000 + 600, email: "push@p.iam.gserviceaccount.com", email_verified: true };
  const opts = { now: NOW, fetchKeys: async () => [jwk] };
  const h = (t: string) => H({ authorization: `Bearer ${t}` });
  const v = VERIFIERS["google-pubsub"];
  it("accepts a good token and rejects bad aud, expiry, wrong key, wrong email, no header", async () => {
    expect(await v("", h(mint(claims)), "https://x.test/hook|push@p.iam.gserviceaccount.com", opts)).toBe(true);
    expect(await v("", h(mint(claims)), "https://other", opts)).toBe(false);
    expect(await v("", h(mint({ ...claims, exp: NOW / 1000 - 1 })), "https://x.test/hook", opts)).toBe(false);
    expect(await v("", h(mint(claims, generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey)), "https://x.test/hook", opts)).toBe(false);
    expect(await v("", h(mint(claims)), "https://x.test/hook|evil@x.com", opts)).toBe(false);
    expect(await v("", H({}), "https://x.test/hook", opts)).toBe(false);
  });
});

describe("helpers", () => {
  it("safeEqual handles length mismatch", () => { expect(safeEqual("a", "ab")).toBe(false); expect(safeEqual("ab", "ab")).toBe(true); });
  it("scheme map", () => { expect(schemeFor("whatsapp")).toBe("meta"); expect(schemeFor("csv")).toBeUndefined(); expect(schemeFor("zapier")).toBe("standard"); });
  it("pickSecret reads JSON bundles and plain strings", () => {
    expect(pickSecret('{"app_secret":"a","x":"y"}')).toBe("a");
    expect(pickSecret('{"nothing":"y"}')).toBeNull();
    expect(pickSecret("plain")).toBe("plain");
    expect(pickSecret(null)).toBeNull();
  });
  it("event id prefers vendor ids, else body hash; headers allow-list drops signatures", () => {
    expect(providerEventId("razorpay", H({ "x-razorpay-event-id": "evt_1" }), "{}")).toBe("evt_1");
    expect(providerEventId("slack", H({}), '{"event_id":"Ev1"}')).toBe("Ev1");
    expect(providerEventId("meta", H({}), "abc")).toMatch(/^sha256:[0-9a-f]{64}$/);
    const kept = allowListedHeaders(H({ "content-type": "a/b", "x-hub-signature-256": "sha256=zz", authorization: "Bearer t" }));
    expect(Object.keys(kept)).toEqual(["content-type"]);
  });
});
