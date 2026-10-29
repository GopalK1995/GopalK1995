import { scrub } from "./scrub";

export type LogFields = { request_id?: string; principal_kind?: string; user_id?: string; route?: string; ms?: number; [k: string]: unknown };

async function hashId(id: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** JSON line logger. user_id is hashed, free text is PII-scrubbed. */
export async function log(level: "info" | "warn" | "error", msg: string, fields: LogFields = {}): Promise<void> {
  const { user_id, ...rest } = fields;
  const line = { level, msg: scrub(msg), ts: new Date().toISOString(), ...scrub(rest), ...(user_id ? { user: await hashId(user_id) } : {}) };
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(JSON.stringify(line));
}
