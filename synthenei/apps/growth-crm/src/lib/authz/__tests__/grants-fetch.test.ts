import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  client: "ok" as "ok" | "none" | "throws", rpc: { data: null as unknown, error: null as null | { code?: string; message?: string } },
  calls: [] as [string, unknown][], schemaCalls: 0,
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    if (state.client === "none") return null;
    return {
      // The authz schema is not exposed by PostgREST (406): the fetch must never address it.
      schema: () => { state.schemaCalls++; throw new Error("406 schema not exposed"); },
      rpc: async (fn: string, args: unknown) => { state.calls.push([fn, args]); if (state.client === "throws") throw new Error("network down"); return state.rpc; },
    };
  },
}));
import { fetchMyGrants } from "../grants-fetch";

beforeEach(() => { state.client = "ok"; state.rpc = { data: null, error: null }; state.calls = []; state.schemaCalls = 0; });

describe("fetchMyGrants (prefetched by requireActive, consumed by loadPrincipal)", () => {
  it("returns the rpc data", async () => {
    state.rpc = { data: { role: "owner" }, error: null };
    expect(await fetchMyGrants("W1")).toEqual({ client: true, data: { role: "owner" }, error: null });
  });
  it("calls the public my_grants wrapper, never schema('authz')", async () => {
    await fetchMyGrants("W1");
    expect(state.schemaCalls).toBe(0);
    expect(state.calls).toEqual([["my_grants", { p_ws: "W1" }]]);
  });
  it("never throws: a missing client, an rpc error and a thrown fetch all come back as values so a prefetch cannot reject unhandled", async () => {
    state.client = "none";
    expect(await fetchMyGrants("W1")).toEqual({ client: false });
    state.client = "ok"; state.rpc = { data: null, error: { code: "42883", message: "missing" } };
    expect(await fetchMyGrants("W1")).toMatchObject({ client: true, data: null, error: { code: "42883" } });
    state.client = "throws";
    expect(await fetchMyGrants("W1")).toMatchObject({ client: true, error: { message: "network down" } });
  });
});
