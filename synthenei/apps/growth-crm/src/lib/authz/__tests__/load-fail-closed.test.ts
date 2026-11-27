import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  demo: false,
  client: "ok" as "ok" | "none",
  rpc: { data: null as unknown, error: null as null | { code?: string; message?: string } },
}));

vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("@/lib/auth/server", () => ({
  requireActive: async () => ({
    session: { uid: "u1", demo: state.demo },
    active: { ws: { id: "ws1", uuid: "W1", name: "Main" }, tenant: { id: "t1", name: "Org", status: "active" }, role: "owner", support: null },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => (state.client === "none" ? null : { rpc: async () => state.rpc }),
}));
vi.mock("@/lib/billing/runtime", () => ({ withBilling: async (p: unknown) => p }));

import { loadPrincipal, assertCan } from "../load";
import { GrantsUnavailableError } from "../errors";
import { toApiError } from "@/lib/api/errors";

beforeEach(() => {
  state.demo = false; state.client = "ok"; state.rpc = { data: null, error: null };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("loadPrincipal fails closed for real sessions (AUD-003)", () => {
  it("my_grants RPC error denies instead of granting the legacy owner matrix", async () => {
    state.rpc = { data: null, error: { code: "42883", message: "function authz.my_grants does not exist" } };
    await expect(loadPrincipal()).rejects.toBeInstanceOf(GrantsUnavailableError);
    await expect(assertCan("leads.read")).rejects.toBeInstanceOf(GrantsUnavailableError);
    expect(console.error).toHaveBeenCalled();
  });
  it("empty RPC result denies", async () => {
    state.rpc = { data: null, error: null };
    await expect(loadPrincipal()).rejects.toMatchObject({ name: "GrantsUnavailableError", cause: "empty_result", status: 503 });
  });
  it("missing Supabase client for a real session denies", async () => {
    state.client = "none";
    await expect(loadPrincipal()).rejects.toMatchObject({ cause: "no_client" });
  });
  it("maps to HTTP 503 in the API error envelope", () => {
    const e = toApiError(new GrantsUnavailableError("rpc_error"));
    expect(e.status).toBe(503);
    expect(e.code).toBe("unavailable");
  });
  it("demo sessions keep the fixture-role path", async () => {
    state.demo = true; state.client = "none";
    const p = await loadPrincipal();
    expect(p.uid).toBe("u1");
    expect(Object.keys(p.grants).length).toBeGreaterThan(0);
  });
});
