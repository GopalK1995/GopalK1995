import { describe, expect, it } from "vitest";
import en from "../../../../../../messages/en/integrations.json";
import ta from "../../../../../../messages/ta/integrations.json";
import { makeT } from "../strings";

describe("integrations strings", () => {
  const enKeys = Object.keys(en);
  it("Tamil keys are a subset of English, flagged for review", () => {
    const extra = Object.keys(ta).filter((k) => !k.startsWith("_") && !enKeys.includes(k));
    expect(extra).toEqual([]);
    expect((ta as Record<string, unknown>)._review).toBe(true);
  });
  it("English copy has no em dashes or exclamation marks", () => {
    for (const v of Object.values(en)) expect(String(v)).not.toMatch(/—|!/);
  });
  it("every chip state, run status and error code has a label", () => {
    const t = makeT("en");
    for (const k of ["not_available", "needs_vendor_approval", "needs_client_credentials", "not_configured", "available", "sandbox", "needs_attention", "error", "disconnected", "connected"]) expect(t(`chip.${k}`)).not.toBe(`chip.${k}`);
    for (const k of ["running", "success", "partial", "failed"]) expect(t(`run.${k}`)).not.toBe(`run.${k}`);
    for (const k of ["unknown_connector", "not_available", "not_configured", "needs_vendor_approval", "needs_client_credentials", "already_connected", "not_found", "invalid_input", "credentials_rejected", "vault_failed", "audit_failed", "wrong_auth", "generic"]) expect(t(`err.${k}`)).not.toBe(`err.${k}`);
    for (const k of ["not_available", "needs_vendor_approval", "needs_client_credentials", "not_configured", "not_shipped", "support", "permission", "not_connected"]) expect(t(`blocked.${k}`)).not.toBe(`blocked.${k}`);
  });
  it("Tamil falls back to English per key and fills variables", () => {
    expect(makeT("ta")("err.vault_failed")).toBe(en["err.vault_failed"]);
    expect(makeT("en")("disconnectTitle", { name: "Mock" })).toBe("Disconnect Mock?");
  });
});
