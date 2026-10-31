import { describe, expect, it } from "vitest";
import { deriveChip, modeForNewConnection, type AvailabilityRow, type ChipState, type ConnectionFacts } from "../status";

const A = (mode: AvailabilityRow["mode"], gateStatus: AvailabilityRow["gateStatus"] = "ready"): AvailabilityRow => ({ mode, gateStatus });
const C = (status: ConnectionFacts["status"], mode: ConnectionFacts["mode"] = "live", hasCredentials = true): ConnectionFacts => ({ status, mode, hasCredentials });

// Truthfulness table: availability + connection + env -> chip
const TABLE: [string, AvailabilityRow | null, ConnectionFacts | null, boolean, ChipState][] = [
  ["no availability row", null, null, true, "not_available"],
  ["disabled", A("disabled"), null, true, "not_available"],
  ["live, gate needs vendor approval", A("live", "needs_vendor_approval"), null, true, "needs_vendor_approval"],
  ["live, gate needs client credentials", A("live", "needs_client_credentials"), null, true, "needs_client_credentials"],
  ["env missing", A("live"), null, false, "not_configured"],
  ["sandbox available, no connection", A("sandbox", "needs_vendor_approval"), null, true, "available"],
  ["live ready, no connection", A("live"), null, true, "available"],
  ["showcase row is not a connection", A("live"), C("showcase", "live", false), true, "available"],
  ["connected status but NO credentials", A("live"), C("connected", "live", false), true, "available"],
  ["credentials, live gate, live conn", A("live"), C("connected", "live"), true, "connected"],
  ["credentials + connected but availability sandbox", A("sandbox"), C("connected", "live"), true, "sandbox"],
  ["credentials + connected but gate not ready", A("live", "needs_vendor_approval"), C("connected", "live"), true, "sandbox"],
  ["credentials + live avail but connection is sandbox", A("live"), C("sandbox", "sandbox"), true, "sandbox"],
  ["needs attention", A("live"), C("needs_attention"), true, "needs_attention"],
  ["error", A("live"), C("error"), true, "error"],
  ["credentials but availability turned off", A("disabled"), C("connected"), true, "not_available"],
  ["disconnected", A("live"), C("disconnected", "live", false), true, "disconnected"],
];

describe("status chip truthfulness", () => {
  it.each(TABLE)("%s", (_n, availability, connection, envConfigured, want) => {
    expect(deriveChip({ availability, connection, envConfigured }).state).toBe(want);
  });
  it("never says connected unless credentials AND live gate AND live connection", () => {
    const modes: AvailabilityRow["mode"][] = ["disabled", "sandbox", "live"];
    const gates: AvailabilityRow["gateStatus"][] = ["needs_vendor_approval", "needs_client_credentials", "ready"];
    const statuses: ConnectionFacts["status"][] = ["connected", "sandbox", "needs_attention", "error", "not_configured", "showcase", "disconnected"];
    for (const mode of modes) for (const gateStatus of gates) for (const status of statuses) for (const cm of ["sandbox", "live"] as const) for (const cred of [true, false]) for (const env of [true, false]) {
      const s = deriveChip({ availability: { mode, gateStatus }, connection: { status, mode: cm, hasCredentials: cred }, envConfigured: env }).state;
      if (s === "connected") expect(cred && mode === "live" && gateStatus === "ready" && cm === "live" && status === "connected").toBe(true);
    }
  });
  it("new connections are live only when the platform says live and the gate is ready", () => {
    expect(modeForNewConnection(A("live"))).toBe("live");
    expect(modeForNewConnection(A("live", "needs_vendor_approval"))).toBe("sandbox");
    expect(modeForNewConnection(A("sandbox"))).toBe("sandbox");
    expect(modeForNewConnection(A("disabled"))).toBeNull();
    expect(modeForNewConnection(null)).toBeNull();
  });
  it("block reasons", () => {
    expect(deriveChip({ availability: A("live", "needs_vendor_approval"), connection: null, envConfigured: true }).blockReason).toBe("needs_vendor_approval");
    expect(deriveChip({ availability: A("sandbox"), connection: null, envConfigured: true }).blockReason).toBeNull();
  });
});
