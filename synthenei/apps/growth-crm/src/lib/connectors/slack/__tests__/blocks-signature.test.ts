// Block builder and request signature.
import { describe, expect, it } from "vitest";
import vectors from "../../verify/__fixtures__/vectors.json";
import { VERIFIERS } from "../../verify";
import { buildAlertMessage, clip, mrkdwn, plain } from "../blocks";
import { LIMITS } from "../constants";
import { SLACK_TOLERANCE_SEC, slackSignature, verifySlackRequest } from "../signature";

describe("block builder", () => {
  it("escapes Slack control characters so data cannot mention or link", () => {
    expect(mrkdwn("<!channel> a & b <https://evil.example|click>")).toBe("&lt;!channel&gt; a &amp; b &lt;https://evil.example|click&gt;");
    const m = buildAlertMessage({ title: "t", fields: [{ label: "Source", value: "<!channel> & <@U123>" }] });
    const text = JSON.stringify(m.blocks);
    expect(text).not.toContain("<!channel>");
    expect(text).toContain("&lt;!channel&gt; &amp; &lt;@U123&gt;");
  });
  it("header is plain text, flattened and clipped; fallback text is set", () => {
    const m = buildAlertMessage({ title: `line1\nline2 ${"x".repeat(400)}` });
    const h = m.blocks[0] as { text: { type: string; text: string } };
    expect(h.text.type).toBe("plain_text");
    expect(h.text.text.length).toBeLessThanOrEqual(LIMITS.headerText);
    expect(h.text.text).not.toMatch(/\n/);
    expect(m.text.length).toBeLessThanOrEqual(LIMITS.fallbackText);
  });
  it("keeps every block inside Slack's limits for hostile input", () => {
    const fields = Array.from({ length: 30 }, (_v, i) => ({ label: `L${i}`, value: "v".repeat(5000) }));
    const m = buildAlertMessage({ title: "t", fields, context: "c".repeat(9000), url: "https://crm.example.test/x" });
    const sec = m.blocks[1] as { fields: { text: string }[] };
    expect(sec.fields.length).toBe(LIMITS.fields);
    for (const f of sec.fields) expect(f.text.length).toBeLessThanOrEqual(LIMITS.fieldText);
    expect(m.blocks.length).toBeLessThanOrEqual(LIMITS.blocks);
  });
  it("drops empty fields; the button exists only for an https url", () => {
    const withBtn = buildAlertMessage({ title: "t", fields: [{ label: "A", value: "  " }], url: "https://crm.example.test/leads/1", buttonLabel: "Open lead" });
    expect(withBtn.blocks.map((b) => b.type)).toEqual(["header", "actions"]);
    for (const url of ["http://crm.example.test/x", "javascript:alert(1)", "", null, undefined, `https://x.test/${"a".repeat(3100)}`]) {
      expect(buildAlertMessage({ title: "t", url }).blocks.map((b) => b.type)).toEqual(["header"]);
    }
  });
  it("clip and plain behave on edges", () => {
    expect(clip("abc", 3)).toBe("abc");
    expect(clip("abcd", 3)).toBe("ab…");
    expect(plain("  a\u0000\u0007 b  ", 10)).toBe("a b");
  });
});

describe("Slack request signature", () => {
  const v = vectors.slackDocsExample;
  const base = { rawBody: v.body, timestamp: v.timestamp, signature: v.signature, secret: v.secret, nowMs: Number(v.timestamp) * 1000 };
  it("matches Slack's published example", () => {
    expect(slackSignature(v.secret, v.timestamp, v.body)).toBe(v.signature);
    expect(verifySlackRequest(base)).toEqual({ ok: true });
  });
  it("agrees with the edge verifier (T023) on accept and reject", () => {
    const h = (sig: string, ts = v.timestamp) => new Headers({ "x-slack-signature": sig, "x-slack-request-timestamp": ts });
    const now = Number(v.timestamp) * 1000;
    expect(VERIFIERS.slack(v.body, h(v.signature), v.secret, { now })).toBe(true);
    expect(VERIFIERS.slack(`${v.body}x`, h(v.signature), v.secret, { now })).toBe(false);
    expect(verifySlackRequest({ ...base, rawBody: `${v.body}x` }).ok).toBe(false);
  });
  it("rejects a changed body, wrong secret, wrong version prefix and a flipped last character", () => {
    expect(verifySlackRequest({ ...base, rawBody: v.body.replace("T1DC2JH3J", "T2") })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifySlackRequest({ ...base, secret: "other" })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifySlackRequest({ ...base, signature: v.signature.replace("v0=", "v1=") })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifySlackRequest({ ...base, signature: v.signature.slice(0, -1) + (v.signature.endsWith("3") ? "4" : "3") })).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("rejects missing secret / headers, junk timestamps and stale or future requests", () => {
    expect(verifySlackRequest({ ...base, secret: "" })).toEqual({ ok: false, reason: "no_secret" });
    expect(verifySlackRequest({ ...base, secret: undefined })).toEqual({ ok: false, reason: "no_secret" });
    expect(verifySlackRequest({ ...base, signature: null })).toEqual({ ok: false, reason: "missing_headers" });
    expect(verifySlackRequest({ ...base, timestamp: undefined })).toEqual({ ok: false, reason: "missing_headers" });
    expect(verifySlackRequest({ ...base, timestamp: "12ab" })).toEqual({ ok: false, reason: "bad_timestamp" });
    expect(verifySlackRequest({ ...base, nowMs: base.nowMs + (SLACK_TOLERANCE_SEC + 1) * 1000 })).toEqual({ ok: false, reason: "stale" });
    expect(verifySlackRequest({ ...base, nowMs: base.nowMs - (SLACK_TOLERANCE_SEC + 1) * 1000 })).toEqual({ ok: false, reason: "stale" });
    expect(verifySlackRequest({ ...base, nowMs: base.nowMs + SLACK_TOLERANCE_SEC * 1000 })).toEqual({ ok: true });
  });
});
