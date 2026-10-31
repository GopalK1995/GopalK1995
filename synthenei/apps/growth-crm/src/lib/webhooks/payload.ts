// Outbound payload envelope: ids and safe fields only. `org_id` is the public alias of tenant_id (CONTRACTS C11).
import type { CrmEvent } from "@/lib/events/types";

export interface WebhookEnvelope {
  id: string; type: string; created_at: string; org_id: string; workspace_id: string;
  object_type: string | null; object_id: string | null; actor: { kind: string; id: string | null }; version: 1;
  data: Record<string, unknown>;
}

/** Keys that carry personal data. A key matches when any underscore-separated word of it is listed. */
const PII_WORDS = new Set(["email", "phone", "mobile", "whatsapp", "msisdn", "address", "street", "dob", "birth", "birthday", "aadhaar", "pan", "passport", "ssn", "ip", "body", "text", "content", "note", "notes", "comment", "firstname", "lastname", "fullname", "contactname", "pincode", "zip"]);
const PII_PAIRS = [["first", "name"], ["last", "name"], ["full", "name"], ["contact", "name"], ["display", "name"]];

export function isPiiKey(key: string): boolean {
  const words = key.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some((w) => PII_WORDS.has(w))) return true;
  return PII_PAIRS.some(([a, b]) => words.some((w, i) => w === a && words[i + 1] === b));
}

const MAX_DEPTH = 4;
const MAX_STRING = 500;

/** Removes PII keys (unless `includePii`), masked fields and over-long strings; deep, bounded. */
export function sanitizeData(value: unknown, opts: { includePii: boolean; masked?: ReadonlySet<string> }, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => sanitizeData(v, opts, depth + 1)).filter((v) => v !== undefined);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (opts.masked?.has(k)) continue;
      if (!opts.includePii && isPiiKey(k)) continue;
      const s = sanitizeData(v, opts, depth + 1);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  return undefined;
}

/** changed_fields lists names only; with PII excluded the names of PII fields are dropped too so they do not leak that a field exists. */
export function buildEnvelope(ev: CrmEvent, opts: { includePii: boolean; masked?: ReadonlySet<string> }): WebhookEnvelope {
  const data = sanitizeData(ev.data, opts) as Record<string, unknown>;
  if (Array.isArray(ev.data.changed_fields)) {
    data.changed_fields = (ev.data.changed_fields as unknown[]).filter((f): f is string => typeof f === "string" && !opts.masked?.has(f) && (opts.includePii || !isPiiKey(f)));
  }
  return {
    id: ev.id, type: ev.type, created_at: ev.occurredAt, org_id: ev.tenantId, workspace_id: ev.workspaceId,
    object_type: ev.objectType, object_id: ev.objectId, actor: { kind: ev.actor.kind, id: ev.actor.id }, version: 1, data,
  };
}

export const MAX_BODY_BYTES = 256 * 1024;

/** Serialises; an oversized body is replaced by ids only with data_truncated so a receiver can refetch. */
export function serializeEnvelope(env: WebhookEnvelope): string {
  const s = JSON.stringify(env);
  if (Buffer.byteLength(s) <= MAX_BODY_BYTES) return s;
  return JSON.stringify({ ...env, data: { data_truncated: true } });
}

export function testEnvelope(ctx: { id: string; tenantId: string; workspaceId: string; now: string }): WebhookEnvelope {
  return {
    id: ctx.id, type: "webhook.test", created_at: ctx.now, org_id: ctx.tenantId, workspace_id: ctx.workspaceId,
    object_type: null, object_id: null, actor: { kind: "system", id: null }, version: 1, data: { message: "Test event from Synthan CRM" },
  };
}
