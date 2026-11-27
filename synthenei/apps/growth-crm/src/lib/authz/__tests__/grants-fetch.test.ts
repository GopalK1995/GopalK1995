import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ rpc: [] as [string, unknown][], schema: [] as string[] }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    // The authz schema is not exposed by PostgREST (406): the fetch must never address it.
    schema: (s: string) => { calls.schema.push(s); throw new Error("406 schema not exposed"); },
    rpc: async (fn: string, args: unknown) => { calls.rpc.push([fn, args]); return { data: { role: { key: "owner" } }, error: null }; },
  }),
}));

import { fetchMyGrants } from "../grants-fetch";

describe("fetchMyGrants", () => {
  it("calls the public my_grants wrapper, never schema('authz')", async () => {
    const r = await fetchMyGrants("W1");
    expect(calls.schema).toEqual([]);
    expect(calls.rpc).toEqual([["my_grants", { p_ws: "W1" }]]);
    expect(r).toMatchObject({ client: true, error: null });
  });
});
