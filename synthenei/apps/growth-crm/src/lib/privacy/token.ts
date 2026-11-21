// Sealed intake token: AES-256-GCM, v1.<iv>.<ciphertext>.<tag> (base64url). It carries the requester's address so the verification link can
// be opened without storing the address anywhere (privacy_requests keeps only its hash). Confidential and authenticated: it cannot be read
// from a log line or forged. The key is derived from PRIVACY_VERIFY_SECRET; with the secret unset nothing can be sealed or opened.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export interface IntakePayload { w: string; k: string; e: string; d: string; p: string[]; exp: number }
export type OpenResult = { ok: true; value: IntakePayload } | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

const key = (secret: string): Buffer => createHmac("sha256", "privacy-intake|v1").update(secret).digest();

export function sealIntake(p: Omit<IntakePayload, "exp">, secret: string, nowMs: number, ttlMs: number): string {
  if (!secret) throw new Error("privacy: verification secret missing");
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key(secret), iv);
  const ct = Buffer.concat([c.update(JSON.stringify({ ...p, exp: nowMs + ttlMs }), "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${ct.toString("base64url")}.${c.getAuthTag().toString("base64url")}`;
}

export function openIntake(token: string | null | undefined, secret: string, nowMs: number): OpenResult {
  if (!token || !secret || token.length > 4096) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1" || parts.slice(1).some((x) => !x)) return { ok: false, reason: "malformed" };
  let plain: string;
  try {
    const d = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(parts[1], "base64url"));
    d.setAuthTag(Buffer.from(parts[3], "base64url"));
    plain = Buffer.concat([d.update(Buffer.from(parts[2], "base64url")), d.final()]).toString("utf8");
  } catch { return { ok: false, reason: "bad_signature" }; }
  try {
    const v = JSON.parse(plain) as IntakePayload;
    if (typeof v.exp !== "number" || typeof v.w !== "string" || typeof v.k !== "string" || typeof v.e !== "string" || !Array.isArray(v.p)) return { ok: false, reason: "malformed" };
    if (v.exp < nowMs) return { ok: false, reason: "expired" };
    return { ok: true, value: { ...v, d: typeof v.d === "string" ? v.d : "" } };
  } catch { return { ok: false, reason: "malformed" }; }
}
