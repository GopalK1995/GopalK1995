import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { b64urlDecode, b64urlEncode, signRequest, verifySignedRequest } from "../meta-signed-request";

const SECRET = "test-app-secret";
const payload = { algorithm: "HMAC-SHA256", issued_at: 1700000000, user_id: "1234567890123456" };

describe("verifySignedRequest", () => {
  it("accepts a good signature and returns the user id", () => {
    const r = verifySignedRequest(signRequest(payload, SECRET), SECRET);
    expect(r).toMatchObject({ ok: true, userId: "1234567890123456" });
  });
  it("accepts a numeric user_id and lower-case algorithm", () => {
    const r = verifySignedRequest(signRequest({ algorithm: "hmac-sha256", user_id: 42 }, SECRET), SECRET);
    expect(r).toMatchObject({ ok: true, userId: "42" });
  });
  it("rejects the wrong secret", () => {
    expect(verifySignedRequest(signRequest(payload, SECRET), "other-secret")).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("rejects a tampered payload (user id swapped, signature kept)", () => {
    const [sig] = signRequest(payload, SECRET).split(".");
    const forged = `${sig}.${b64urlEncode(JSON.stringify({ ...payload, user_id: "999" }))}`;
    expect(verifySignedRequest(forged, SECRET)).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("rejects a tampered signature", () => {
    const [sig, body] = signRequest(payload, SECRET).split(".");
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(verifySignedRequest(`${flipped}.${body}`, SECRET).ok).toBe(false);
  });
  it("rejects a truncated or empty signature, extra parts, and non-strings", () => {
    const good = signRequest(payload, SECRET);
    const [sig, body] = good.split(".");
    for (const bad of [`${sig.slice(0, 10)}.${body}`, `.${body}`, `${sig}.`, `${good}.x`, "", "nodot", 42, null, undefined, {}]) expect(verifySignedRequest(bad, SECRET).ok).toBe(false);
  });
  it("refuses everything when the secret is not configured", () => {
    expect(verifySignedRequest(signRequest(payload, SECRET), undefined)).toEqual({ ok: false, reason: "no_secret" });
    expect(verifySignedRequest(signRequest(payload, SECRET), "")).toEqual({ ok: false, reason: "no_secret" });
  });
  it("rejects a validly signed payload with the wrong algorithm, no user id, a non-numeric id or non-JSON", () => {
    expect(verifySignedRequest(signRequest({ ...payload, algorithm: "HMAC-SHA1" }, SECRET), SECRET)).toEqual({ ok: false, reason: "bad_algorithm" });
    expect(verifySignedRequest(signRequest({ algorithm: "HMAC-SHA256" }, SECRET), SECRET)).toEqual({ ok: false, reason: "no_user_id" });
    expect(verifySignedRequest(signRequest({ ...payload, user_id: "12; drop table" }, SECRET), SECRET)).toEqual({ ok: false, reason: "no_user_id" });
    const body = b64urlEncode("not json");
    const sig = b64urlEncode(createHmac("sha256", SECRET).update(body).digest());
    expect(verifySignedRequest(`${sig}.${body}`, SECRET)).toEqual({ ok: false, reason: "bad_payload" });
    const arr = b64urlEncode("[1]");
    expect(verifySignedRequest(`${b64urlEncode(createHmac("sha256", SECRET).update(arr).digest())}.${arr}`, SECRET)).toEqual({ ok: false, reason: "bad_payload" });
  });
  it("tolerates base64url padding when the signature covers the unpadded text", () => {
    const body = b64urlEncode(JSON.stringify(payload));
    const sig = b64urlEncode(createHmac("sha256", SECRET).update(body).digest());
    expect(verifySignedRequest(`${sig}=.${body}=`, SECRET).ok).toBe(true);
  });
  it("rejects the standard base64 alphabet (+ and /) and whitespace", () => {
    const body = b64urlEncode(JSON.stringify(payload));
    expect(verifySignedRequest(`ab+c/d.${body}`, SECRET).ok).toBe(false);
    expect(verifySignedRequest(` ${signRequest(payload, SECRET)}`, SECRET).ok).toBe(false);
  });
  it("rejects an oversized value", () => { expect(verifySignedRequest(`${"a".repeat(9000)}.b`, SECRET).ok).toBe(false); });
});

describe("b64urlDecode", () => {
  it("round-trips bytes that produce - and _ in the encoding", () => {
    const bytes = Buffer.from([0xfb, 0xff, 0xfe, 0x3e, 0x3f]);
    const enc = b64urlEncode(bytes);
    expect(enc).toMatch(/[-_]/);
    expect(b64urlDecode(enc)?.equals(bytes)).toBe(true);
  });
  it("handles every length remainder and impossible lengths", () => {
    for (const s of ["a", "ab", "abc"]) expect(b64urlDecode(b64urlEncode(s))?.toString()).toBe(s);
    expect(b64urlDecode("a")).toBeNull();
    expect(b64urlDecode("")).toBeNull();
    expect(b64urlDecode("ab cd")).toBeNull();
    expect(b64urlDecode("ab+d")).toBeNull();
  });
});
