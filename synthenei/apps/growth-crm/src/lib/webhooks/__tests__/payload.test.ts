import { describe, expect, it } from "vitest";
import type { CrmEvent } from "@/lib/events/types";
import { buildEnvelope, isPiiKey, sanitizeData, serializeEnvelope, MAX_BODY_BYTES } from "../payload";
import { joinEventTypes, passesFilters, splitEventTypes, validateFilters } from "../options";

const ev = (data: Record<string, unknown>): CrmEvent => ({ id: "42", type: "lead.updated", tenantId: "t-1", workspaceId: "w-1", objectType: "lead", objectId: "l-1", actor: { kind: "user", id: "u-1" }, occurredAt: "2026-11-01T00:00:00Z", version: 1, data });

describe("payload envelope", () => {
  it("has id, type, created_at, org_id (tenant alias), workspace_id and ids", () => {
    const e = buildEnvelope(ev({ changed_fields: ["stage"], after: { stage: "won" } }), { includePii: false });
    expect(e).toMatchObject({ id: "42", type: "lead.updated", created_at: "2026-11-01T00:00:00Z", org_id: "t-1", workspace_id: "w-1", object_type: "lead", object_id: "l-1", version: 1 });
    expect(e).not.toHaveProperty("tenant_id");
    expect(e.data).toEqual({ changed_fields: ["stage"], after: { stage: "won" } });
  });
  it("drops PII keys and PII field names from changed_fields unless opted in", () => {
    const d = ev({ changed_fields: ["email", "stage", "phone_number"], before: { email: "a@b.co", stage: "new" }, after: { email: "c@d.co", stage: "won", full_name: "Ana", whatsapp: "+91 90000 00000" } });
    const safe = buildEnvelope(d, { includePii: false });
    expect(JSON.stringify(safe)).not.toMatch(/a@b\.co|c@d\.co|Ana|90000|email|phone|whatsapp|full_name/);
    expect(safe.data.changed_fields).toEqual(["stage"]);
    const full = buildEnvelope(d, { includePii: true });
    expect(JSON.stringify(full)).toMatch(/c@d\.co/);
  });
  it("honours field masks even when PII is included", () => {
    const e = buildEnvelope(ev({ after: { stage: "won", score: 90 } }), { includePii: true, masked: new Set(["score"]) });
    expect(e.data.after).toEqual({ stage: "won" });
  });
  it("recognises PII keys by word, not by substring", () => {
    expect(["email", "contact_phone", "whatsapp_id", "first_name", "owner_email", "message_body"].every(isPiiKey)).toBe(true);
    expect(["stage", "amount", "owner_id", "pipeline_id", "ipad_count", "company"].some(isPiiKey)).toBe(false);
  });
  it("bounds depth and string length, and replaces an oversized body by ids only", () => {
    expect(sanitizeData({ a: { b: { c: { d: { e: 1 } } } } }, { includePii: false })).toEqual({ a: { b: { c: {} } } });
    expect((sanitizeData({ s: "x".repeat(900) }, { includePii: false }) as { s: string }).s.length).toBe(500);
    const big = buildEnvelope(ev({ after: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`f${i}`, "y".repeat(400)])) }), { includePii: false });
    const s = serializeEnvelope(big);
    expect(Buffer.byteLength(s)).toBeLessThan(MAX_BODY_BYTES);
    expect(JSON.parse(s)).toMatchObject({ id: "42", data: { data_truncated: true } });
  });
});

describe("subscription options", () => {
  it("round-trips pii and filters through event_types without leaking into the type list", () => {
    const stored = joinEventTypes(["lead.created", "deal.*"], { pii: true, filters: [{ field: "stage", values: ["won", "lost"] }] });
    const back = splitEventTypes(stored);
    expect(back.types).toEqual(["lead.created", "deal.*"]);
    expect(back.options).toEqual({ pii: true, filters: [{ field: "stage", values: ["won", "lost"] }] });
  });
  it("evaluates filters AND across fields and OR within values", () => {
    const f = [{ field: "stage", values: ["won", "lost"] }, { field: "object_type", values: ["lead"] }];
    expect(passesFilters(f, { objectType: "lead", data: { after: { stage: "won" } } })).toBe(true);
    expect(passesFilters(f, { objectType: "deal", data: { after: { stage: "won" } } })).toBe(false);
    expect(passesFilters(f, { objectType: "lead", data: { after: { stage: "open" } } })).toBe(false);
    expect(passesFilters(f, { objectType: "lead", data: {} })).toBe(false);
    expect(passesFilters([], { objectType: null, data: {} })).toBe(true);
  });
  it("validates filter shape", () => {
    expect(validateFilters([{ field: "stage", values: ["won"] }])).toBeNull();
    expect(validateFilters([{ field: "Bad Field", values: ["x"] }])).toBe("filterBadField");
    expect(validateFilters([{ field: "stage", values: [] }])).toBe("filterBadValue");
    expect(validateFilters(Array.from({ length: 6 }, () => ({ field: "a", values: ["b"] })))).toBe("filterTooMany");
  });
});
