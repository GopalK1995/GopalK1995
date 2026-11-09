// Pure units: merge-field rendering (HTML escaping), unsubscribe tokens (signed, expiring), suppression logic, MIME build.
import { describe, expect, it } from "vitest";
import { escapeHtml, htmlToText, mergeFieldsOf, renderMerge } from "../merge";
import { buildMime, dotStuff, encodeWord, formatAddress, isEmail, MimeError } from "../mime";
import { isHardBounce, isSuppressed, normaliseEmail, suppressionFor, withdrawsConsent } from "../suppression";
import { signUnsubscribe, unsubscribeOneClickUrl, unsubscribePageUrl, verifyUnsubscribe } from "../unsubscribe";

describe("merge fields", () => {
  it("escapes HTML in substituted values (html mode) and leaves text mode alone", () => {
    const v = { first_name: `<img src=x onerror="alert(1)">&'` };
    const h = renderMerge("<p>Hi {{first_name}}</p>", v, "html");
    expect(h.text).toBe("<p>Hi &lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;</p>");
    expect(h.text).not.toContain("<img");
    expect(renderMerge("Hi {{first_name}}", { first_name: "A & B" }, "text").text).toBe("Hi A & B");
  });
  it("uses the fallback for an empty value and reports a missing field instead of sending a blank", () => {
    expect(renderMerge("Hello {{first_name|there}}", { first_name: "  " }, "text")).toEqual({ text: "Hello there", missing: [] });
    expect(renderMerge("Hello {{first_name}}, {{company}}", { first_name: "Asha" }, "text")).toEqual({ text: "Hello Asha, ", missing: ["company"] });
  });
  it("never lets a value inject a line break into a text subject", () => {
    expect(renderMerge("Re: {{x}}", { x: "a\r\nBcc: evil@x.test" }, "text").text).toBe("Re: a Bcc: evil@x.test");
  });
  it("does not re-expand merge syntax that comes from a value", () => {
    expect(renderMerge("{{a}}", { a: "{{b}}", b: "SECRET" }, "text").text).toBe("{{b}}");
  });
  it("lists the fields a template uses, ignores malformed ones", () => {
    expect(mergeFieldsOf("{{first_name}} {{ company|x }} {{Bad-Name}} {{1}}").sort()).toEqual(["1", "company", "first_name"]);
    expect(escapeHtml("<a>")).toBe("&lt;a&gt;");
    expect(htmlToText("<p>Hi</p><p>Go <a href=\"https://x.test\">here</a></p>")).toBe("Hi\nGo here (https://x.test)");
  });
});

describe("unsubscribe token", () => {
  const S = "k".repeat(32), NOW = 1_800_000_000_000;
  const payload = { t: "t1", w: "w1", c: "c1", l: "lead-1", s: null };
  it("round-trips and carries no email address", () => {
    const tok = signUnsubscribe(payload, S, NOW);
    const v = verifyUnsubscribe(tok, S, NOW + 1000);
    expect(v.ok && v.value).toMatchObject({ t: "t1", w: "w1", c: "c1", l: "lead-1" });
    expect(Buffer.from(tok.split(".")[1], "base64url").toString()).not.toMatch(/@/);
  });
  it("expires", () => {
    const tok = signUnsubscribe(payload, S, NOW, 10);
    expect(verifyUnsubscribe(tok, S, NOW + 9 * 86_400_000).ok).toBe(true);
    expect(verifyUnsubscribe(tok, S, NOW + 11 * 86_400_000)).toEqual({ ok: false, reason: "expired" });
  });
  it("rejects a tampered payload, a tampered signature, another secret and garbage", () => {
    const tok = signUnsubscribe(payload, S, NOW), [v, body, sig] = tok.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, l: "lead-2", exp: NOW + 1e9 })).toString("base64url");
    expect(verifyUnsubscribe(`${v}.${forged}.${sig}`, S, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyUnsubscribe(`${v}.${body}.${sig.slice(0, -2)}AA`, S, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyUnsubscribe(tok, "x".repeat(32), NOW)).toEqual({ ok: false, reason: "bad_signature" });
    for (const g of ["", "abc", "v1.a", "v2.a.b", `${tok}.extra`, "v1..", null, undefined]) expect(verifyUnsubscribe(g as string, S, NOW).ok).toBe(false);
    expect(verifyUnsubscribe(tok, "", NOW).ok).toBe(false);
  });
  it("refuses to sign without a secret or a subject, and builds the links", () => {
    expect(() => signUnsubscribe(payload, "", NOW)).toThrow();
    expect(() => signUnsubscribe({ ...payload, l: null }, S, NOW)).toThrow();
    expect(unsubscribePageUrl("https://app.test/", "T")).toBe("https://app.test/unsubscribe/T");
    expect(unsubscribeOneClickUrl("https://app.test", "T")).toBe("https://app.test/api/email/unsubscribe/T");
  });
});

describe("suppression logic", () => {
  it("only hard bounces and complaints suppress; soft bounces, delays and deliveries never do", () => {
    expect(suppressionFor({ kind: "bounced", hard: true })).toBe("hard_bounce");
    expect(suppressionFor({ kind: "bounced", hard: false })).toBeNull();
    expect(suppressionFor({ kind: "complained" })).toBe("complaint");
    for (const kind of ["delivered", "sent", "delayed", "opened", "clicked"] as const) expect(suppressionFor({ kind })).toBeNull();
    expect(suppressionFor({ kind: "failed" })).toBeNull();
  });
  it("treats only Permanent as hard (Transient and Undetermined are not)", () => {
    expect(isHardBounce("Permanent")).toBe(true);
    expect(isHardBounce(" permanent ")).toBe(true);
    for (const t of ["Transient", "Undetermined", "", undefined, 5]) expect(isHardBounce(t)).toBe(false);
  });
  it("a complaint or unsubscribe withdraws consent; a dead address does not", () => {
    expect(withdrawsConsent("complaint")).toBe(true);
    expect(withdrawsConsent("unsubscribe")).toBe(true);
    expect(withdrawsConsent("hard_bounce")).toBe(false);
  });
  it("matches addresses case-insensitively", () => {
    expect(normaliseEmail("  Asha@Example.COM ")).toBe("asha@example.com");
    expect(isSuppressed([{ email: "Asha@Example.com" }], "asha@EXAMPLE.com")).toBe(true);
    expect(isSuppressed([{ email: "a@x.test" }], "b@x.test")).toBe(false);
  });
});

describe("MIME build", () => {
  const base = { from: { email: "news@brand.test", name: "Brand Team" }, to: { email: "asha@example.com", name: "Asha" }, subject: "Hello", text: "Plain body" };
  it("builds multipart/alternative with both parts, the unsubscribe headers and a message id on the sender's domain", () => {
    const { raw, messageId } = buildMime({ ...base, html: "<p>Rich</p>", headers: { "List-Unsubscribe": "<https://x.test/u>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }, date: new Date("2026-11-01T10:00:00Z") });
    expect(raw).toContain('From: "Brand Team" <news@brand.test>');
    expect(raw).toContain("To: \"Asha\" <asha@example.com>");
    expect(raw).toContain("List-Unsubscribe: <https://x.test/u>");
    expect(raw).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    expect(raw).toContain("multipart/alternative");
    expect(raw).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(raw).toContain("Content-Type: text/html; charset=UTF-8");
    expect(messageId).toMatch(/^<[0-9a-f]{24}@brand\.test>$/);
    expect(Buffer.from(raw.split("text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n")[1].split("\r\n--")[0].replace(/\r\n/g, ""), "base64").toString()).toBe("Plain body");
  });
  it("sends text only when there is no html", () => {
    const { raw } = buildMime(base);
    expect(raw).not.toContain("multipart");
    expect(raw).toContain("Content-Type: text/plain; charset=UTF-8");
  });
  it("encodes non-ASCII subjects and names (RFC 2047), keeping each word short", () => {
    const w = encodeWord("வணக்கம் உங்களுக்கு ஒரு செய்தி வந்துள்ளது");
    expect(w).toMatch(/^=\?UTF-8\?B\?/);
    for (const part of w.split(" ")) expect(part.length).toBeLessThanOrEqual(75);
    expect(formatAddress({ email: "a@b.test", name: "Zoë" })).toMatch(/^=\?UTF-8\?B\?.+\?= <a@b\.test>$/);
  });
  it("refuses header injection through subject, name, extra headers and message id", () => {
    expect(() => buildMime({ ...base, subject: "x\r\nBcc: evil@x.test" })).toThrow(MimeError);
    expect(() => buildMime({ ...base, to: { email: "a@b.test", name: "x\nBcc: e@x.test" } })).toThrow(MimeError);
    expect(() => buildMime({ ...base, headers: { "X-A": "1\r\nBcc: e@x.test" } })).toThrow(MimeError);
    expect(() => buildMime({ ...base, headers: { Bcc: "e@x.test" } })).toThrow(MimeError);
    expect(() => buildMime({ ...base, headers: { To: "e@x.test" } })).toThrow(MimeError);
    expect(() => buildMime({ ...base, messageId: "<a>\r\nBcc: x" })).toThrow(MimeError);
  });
  it("validates addresses", () => {
    for (const ok of ["a@b.co", "first.last+tag@sub.example.org"]) expect(isEmail(ok)).toBe(true);
    for (const bad of ["a", "a@b", "a b@c.co", "<a@b.co>", "a@b.co,c@d.co", "a@@b.co", "a\"@b.co"]) expect(isEmail(bad)).toBe(false);
    expect(() => formatAddress({ email: "nope" })).toThrow(MimeError);
  });
  it("dot-stuffs lines that start with a dot and terminates the data section", () => {
    expect(dotStuff("a\n.b\n..c")).toBe("a\r\n..b\r\n...c\r\n.\r\n");
  });
});
